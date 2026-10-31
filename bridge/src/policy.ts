// What the bridge decides before it signs: which key, which limits, which
// challenges. Nothing here runs at load, so it can be tested without spawning
// the stdio server in index.ts.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

// A mistake the bridge explains in one line rather than a stack trace.
export class UsageError extends Error {}

export type BridgeArgs = {
  node: string;
  network: string;
  maxUsd: number;
  maxPaymentValue: bigint;
};

export function parseBridgeArgs(args: string[]): BridgeArgs {
  const { values } = parseArgs({
    args,
    options: {
      node: { type: "string" },
      network: { type: "string", default: "eip155:84532" },
      "max-usd": { type: "string", default: "1" }
    }
  });
  if (!values.node) {
    throw new UsageError(
      "usage: x402-mcp-bridge --node https://<host>/mcp [--network eip155:84532] [--max-usd 1]"
    );
  }
  const maxUsd = Number(values["max-usd"]);
  if (!Number.isFinite(maxUsd) || maxUsd < 0) {
    throw new UsageError("--max-usd must be a non-negative number");
  }
  return {
    node: values.node,
    network: values.network,
    maxUsd,
    // USDC has 6 decimals.
    maxPaymentValue: BigInt(Math.round(maxUsd * 1e6))
  };
}

// X402_PRIVATE_KEY wins; otherwise self-provision a throwaway key, same
// pattern as lore's canary buyer: no wallet-app export, no hand-edited file.
export function bridgeKey(
  generateKey: () => `0x${string}`,
  env: NodeJS.ProcessEnv = process.env,
  keyFile: string = join(homedir(), ".x402-bridge", "key.env")
): `0x${string}` {
  const fromEnv = env.X402_PRIVATE_KEY;
  if (fromEnv) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(fromEnv)) {
      throw new Error("X402_PRIVATE_KEY is not a 0x-prefixed 32-byte hex key");
    }
    return fromEnv as `0x${string}`;
  }
  try {
    const match = readFileSync(keyFile, "utf8").match(
      /^X402_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m
    );
    if (match) return match[1] as `0x${string}`;
  } catch {
    // No file yet: first run.
  }
  const key = generateKey();
  mkdirSync(dirname(keyFile), { recursive: true, mode: 0o700 });
  writeFileSync(
    keyFile,
    "# Self-provisioned x402-mcp-bridge signer. Fund it only with what you\n" +
      "# are willing to spend through this bridge.\n" +
      `X402_PRIVATE_KEY=${key}\n`,
    { mode: 0o400 }
  );
  return key;
}

// The settlement receipt arrives as _meta["x402/payment-response"] — either a
// base64 JSON string (the HTTP header form) or an already-decoded object.
export function decodeReceipt(raw: unknown): Record<string, unknown> | undefined {
  if (typeof raw === "string") {
    try {
      return JSON.parse(atob(raw)) as Record<string, unknown>;
    } catch {
      return { raw };
    }
  }
  if (typeof raw === "object" && raw !== null) return raw as Record<string, unknown>;
  return undefined;
}

export type PaymentOption = { scheme: string; network: string; amount: string };

export type Approval =
  | { approved: true; amount: bigint }
  | { approved: false; reason: "option"; detail: string }
  | { approved: false; reason: "cap"; amount: bigint };

// The SDK signs whichever entry survives its network filtering — not
// necessarily accepts[0] — so approving here approves *any* entry. A
// hostile node can pair a cheap decoy on a filtered-out network with an
// expensive entry on ours. Every entry must therefore be one this
// process would pay: exact scheme, the configured network, and within
// the remaining budget. Anything else declines the whole challenge.
export function approve(
  accepts: readonly PaymentOption[],
  network: string,
  authorized: bigint,
  cap: bigint
): Approval {
  let amount: bigint;
  try {
    if (accepts.length === 0) throw new Error("empty accepts");
    amount = accepts.reduce((max, entry) => {
      if (entry.scheme !== "exact" || entry.network !== network) {
        throw new Error(`${entry.scheme} on ${entry.network}`);
      }
      const value = BigInt(entry.amount);
      return value > max ? value : max;
    }, 0n);
  } catch (err) {
    return {
      approved: false,
      reason: "option",
      detail: err instanceof Error ? err.message : String(err)
    };
  }
  if (authorized + amount > cap) return { approved: false, reason: "cap", amount };
  return { approved: true, amount };
}
