// Stdio MCP server that fronts one remote x402-paid MCP server. Tools pass
// through unchanged; when the remote answers "payment required", the wrapped
// client signs and retries. The key never enters the model's context — the
// client only ever sees tool results.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult
} from "@modelcontextprotocol/sdk/types.js";
import { toClientEvmSigner } from "@x402/evm";
import { withX402Client } from "agents/x402";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const KEY_DIR = join(homedir(), ".x402-bridge");
const KEY_FILE = join(KEY_DIR, "key.env");

// Every log line goes to stderr as JSON — stdout belongs to the MCP transport.
// This stream is also the demo's live payment feed: `tail -f` the bridge's
// stderr and you watch challenge → paid → receipt as it happens.
function emit(event: string, data: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ event, ...data })}\n`);
}

// X402_PRIVATE_KEY wins; otherwise self-provision a throwaway key, same
// pattern as lore's canary buyer: no wallet-app export, no hand-edited file.
function bridgeKey(): `0x${string}` {
  const fromEnv = process.env.X402_PRIVATE_KEY;
  if (fromEnv) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(fromEnv)) {
      throw new Error("X402_PRIVATE_KEY is not a 0x-prefixed 32-byte hex key");
    }
    return fromEnv as `0x${string}`;
  }
  try {
    const match = readFileSync(KEY_FILE, "utf8").match(
      /^X402_PRIVATE_KEY=(0x[0-9a-fA-F]{64})$/m
    );
    if (match) return match[1] as `0x${string}`;
  } catch {
    // No file yet: first run.
  }
  const key = generatePrivateKey();
  mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(
    KEY_FILE,
    "# Self-provisioned x402-mcp-bridge signer. Fund it only with what you\n" +
      "# are willing to spend through this bridge.\n" +
      `X402_PRIVATE_KEY=${key}\n`,
    { mode: 0o400 }
  );
  return key;
}

// The settlement receipt arrives as _meta["x402/payment-response"] — either a
// base64 JSON string (the HTTP header form) or an already-decoded object.
function decodeReceipt(raw: unknown): Record<string, unknown> | undefined {
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

const { values } = parseArgs({
  options: {
    node: { type: "string" },
    network: { type: "string", default: "eip155:84532" },
    "max-usd": { type: "string", default: "1" }
  }
});
if (!values.node) {
  console.error(
    "usage: x402-mcp-bridge --node https://<host>/mcp [--network eip155:84532] [--max-usd 1]"
  );
  process.exit(1);
}
const maxUsd = Number(values["max-usd"]);
if (!Number.isFinite(maxUsd) || maxUsd < 0) {
  console.error("--max-usd must be a non-negative number");
  process.exit(1);
}
const maxPaymentValue = BigInt(Math.round(maxUsd * 1e6));
let authorizedPaymentValue = 0n;

const account = privateKeyToAccount(bridgeKey());
emit("startup", {
  node: values.node,
  network: values.network,
  maxUsd,
  buyer: account.address
});

const remote = new Client({ name: "x402-mcp-bridge", version: "0.1.0" });
await remote.connect(new StreamableHTTPClientTransport(new URL(values.node)));

const paid = withX402Client(remote, {
  account: toClientEvmSigner(account),
  network: values.network,
  // USDC has 6 decimals. The SDK enforces this per call; the callback below
  // reserves against the same cap across the lifetime of this process.
  maxPaymentValue,
  confirmationCallback: async (accepts) => {
    const selected = accepts[0];
    if (selected?.scheme === "exact") {
      try {
        const amount = BigInt(selected.amount);
        if (
          amount <= maxPaymentValue &&
          authorizedPaymentValue + amount > maxPaymentValue
        ) {
          emit("declined", {
            reason: "cumulative spend cap",
            amount: selected.amount,
            authorized: authorizedPaymentValue.toString(),
            cap: maxPaymentValue.toString()
          });
          return false;
        }
        if (amount <= maxPaymentValue) authorizedPaymentValue += amount;
      } catch {
        // The SDK returns the original payment error for malformed amounts.
      }
    }
    emit("challenge", { accepts });
    return true;
  }
});

const server = new Server(
  { name: "x402-mcp-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // The wrapper annotates paid tools' descriptions with their price, so the
  // model can weigh cost before calling.
  return paid.listTools();
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  emit("call", { tool: request.params.name });
  const result = (await paid.callTool(null, request.params)) as CallToolResult;
  const receipt = decodeReceipt(result._meta?.["x402/payment-response"]);
  if (receipt) {
    emit("settled", { tool: request.params.name, receipt });
    // Surface settlement in the conversation itself, not just this log.
    result.content = [
      ...(result.content ?? []),
      { type: "text", text: `x402 settlement receipt: ${JSON.stringify(receipt)}` }
    ];
  }
  return result;
});

await server.connect(new StdioServerTransport());
emit("ready", {});
