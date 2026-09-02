// Exercises the Worker's paid `get` handler end to end against a stubbed
// facilitator: no network, wallet, or faucet funds involved (MON-010).
// `discover` and damaged-id rejection are already covered by scripts/smoke.ts
// against a real deployment; this suite covers what smoke.ts cannot: the
// facilitator round trip and its failure modes.
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/core/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFacilitator } from "./facilitator";
import { FIXTURE_PUBLICATION_ID } from "./setup";

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type PaymentRequired = Parameters<x402Client["createPaymentPayload"]>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-canary-test", version: "0.1.0" });
  const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    exports.default.fetch(input, init)) as typeof fetch;
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://worker.test/mcp"), { fetch: workerFetch })
  );
  return client;
}

function textOf(result: CallToolResult): Record<string, unknown> {
  const text = (result.content as { text: string }[])[0].text;
  const payload: unknown = JSON.parse(text);
  if (!isRecord(payload)) throw new Error("tool returned a non-object payload");
  return payload;
}

function x402ErrorOf(result: CallToolResult): PaymentRequired {
  const error = result._meta?.["x402/error"];
  expect(error).toBeTruthy();
  return error as PaymentRequired;
}

// Builds a real, locally-signed x402 payment payload from a `get` challenge's
// `accepts` array — the same client machinery scripts/pay.ts uses against a
// live deployment, but signed by a throwaway key that never touches a chain.
async function buildPaymentToken(x402Error: PaymentRequired): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  const paymentClient = new x402Client();
  registerExactEvmScheme(paymentClient, { signer: toClientEvmSigner(account) });
  const paymentPayload = await paymentClient.createPaymentPayload(x402Error);
  return btoa(JSON.stringify(paymentPayload));
}

// Calls the unpaid `get` challenge and turns its `accepts` array into a
// spendable token, exactly as a real buyer's client would after seeing 402.
async function challengeAndBuildToken(client: Client, id = FIXTURE_PUBLICATION_ID): Promise<string> {
  const challenge = await client.callTool({ name: "get", arguments: { id } });
  expect(challenge.isError).toBe(true);
  return buildPaymentToken(x402ErrorOf(challenge));
}

afterEach(async () => {
  vi.restoreAllMocks();
  await env.LORE_DB.prepare("DELETE FROM sales").run();
});

describe("discover", () => {
  it("advertises teasers and topics only — content never reaches the free surface", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const result = await client.callTool({ name: "discover", arguments: {} });
      expect(result.isError).toBeUndefined();
      const payload = textOf(result);
      expect(payload.payout).toBe(env.LORE_WALLET);
      const entries = Object.values(payload.topics as Record<string, object[]>).flat();
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(Object.keys(entry).sort()).toEqual(["id", "kind", "teaser", "updated_at"]);
      }
      expect(JSON.stringify(payload)).not.toContain("owner-approved content");
    } finally {
      await client.close();
    }
  });
});

async function sales() {
  const { results } = await env.LORE_DB.prepare("SELECT * FROM sales").all();
  return results;
}

describe("get (paid)", () => {
  it("returns publication content once the facilitator verifies and settles, and records the sale", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const paid = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(paid.isError).toBeUndefined();
      const publication = textOf(paid).publication as { content: string };
      expect(publication.content).toContain("secret owner-approved content");
      expect(await sales()).toMatchObject([
        {
          kind: "publication",
          item_id: FIXTURE_PUBLICATION_ID,
          title: "Fixture Publication",
          price_usd: 0.01,
          network: "eip155:84532",
          payer: "0xfixturepayer",
          tx: "0xfixturetransaction"
        }
      ]);
    } finally {
      await client.close();
    }
  });

  it("fails closed on an invalid credential: no content, settlement never attempted", async () => {
    const fetchSpy = mockFacilitator({ verify: { kind: "rejected", reason: "INVALID_SIGNATURE" } });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const result = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.["x402/error"]).toBeTruthy();
      expect(JSON.stringify(result)).not.toContain("secret owner-approved content");
      const settleCalls = fetchSpy.mock.calls.filter(([input]) => {
        const url = input instanceof Request ? input.url : input;
        return new URL(url).pathname === "/settle";
      });
      expect(settleCalls).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it("fails closed on a replayed credential: the second use of the same token is rejected", async () => {
    mockFacilitator({ verify: [{ kind: "ok" }, { kind: "rejected", reason: "replay" }] });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const paid = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(paid.isError).toBeUndefined();

      const replay = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(replay.isError).toBe(true);
      expect(JSON.stringify(replay)).not.toContain("secret owner-approved content");
    } finally {
      await client.close();
    }
  });

  it("fails closed when the facilitator 5xxs during verification", async () => {
    mockFacilitator({ verify: { kind: "http-error", status: 500 } });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const result = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret owner-approved content");
    } finally {
      await client.close();
    }
  });

  it("fails closed when the facilitator times out during verification", async () => {
    mockFacilitator({ verify: { kind: "unreachable" } });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const result = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret owner-approved content");
    } finally {
      await client.close();
    }
  });

  it("fails closed when settlement fails after a successful verification", async () => {
    mockFacilitator({ settle: { kind: "http-error", status: 503 } });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const result = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret owner-approved content");
      expect(await sales()).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
