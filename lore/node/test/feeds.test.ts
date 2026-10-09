// MON-045: a feed sells agents a 30-day pass to every piece; get honours the pass without payment.
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/core/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFacilitator } from "./facilitator";
import { FIXTURE_PUBLICATION_ID } from "./setup";

const ORIGIN = "https://worker.test";

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type PaymentRequired = Parameters<x402Client["createPaymentPayload"]>[0];

const textOf = (result: CallToolResult) => JSON.parse((result.content as { text: string }[])[0].text) as Record<string, unknown>;
const feed = (price: string | null) =>
  price === null
    ? env.LORE_DB.prepare("DELETE FROM node_settings WHERE key = 'feed_price_usd'").run()
    : env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES ('feed_price_usd', ?1)").bind(price).run();

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-feeds-test", version: "0.1.0" });
  const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => exports.default.fetch(input, init)) as typeof fetch;
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: workerFetch }));
  return client;
}

async function session<T>(use: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

async function pay(challenge: CallToolResult): Promise<string> {
  // A pass costs more than the client's default $1 cap on one payment.
  const paymentClient = x402Client.fromConfig({ schemes: [], spendControls: false });
  registerExactEvmScheme(paymentClient, { signer: toClientEvmSigner(privateKeyToAccount(generatePrivateKey())) });
  return btoa(JSON.stringify(await paymentClient.createPaymentPayload(challenge._meta?.["x402/error"] as PaymentRequired)));
}

async function subscribe(client: Client): Promise<string> {
  const challenge = await client.callTool({ name: "subscribe", arguments: {} });
  expect(challenge.isError).toBe(true);
  const paid = await client.callTool({ name: "subscribe", arguments: {}, _meta: { "x402/payment": await pay(challenge) } });
  expect(paid.isError).toBeUndefined();
  return textOf(paid).pass as string;
}

beforeEach(async () => {
  mockFacilitator();
  await env.LORE_DB.exec("CREATE TABLE IF NOT EXISTS node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  await feed("5.000000");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await feed(null);
  await env.LORE_DB.exec("DELETE FROM sales").catch(() => undefined);
  await env.LORE_DB.exec("DELETE FROM feed_passes").catch(() => undefined);
});

describe("a feed", () => {
  it("is listed by discover only while it's on", async () => {
    expect(textOf(await session((client) => client.callTool({ name: "discover", arguments: {} }))).feed).toEqual({
      price_usd: 5,
      days: 30,
      tool: "subscribe"
    });
    await feed(null);
    const off = await session(async (client) => ({
      payload: textOf(await client.callTool({ name: "discover", arguments: {} })),
      tools: (await client.listTools()).tools.map((tool) => tool.name)
    }));
    expect(off.payload).not.toHaveProperty("feed");
    expect(off.tools).not.toContain("subscribe");
  });

  it("sells a 30-day pass in one payment and records one sale", async () => {
    const pass = await subscribe(await connect());
    expect(pass).toMatch(/^pass_[0-9a-f]{32}$/);
    const { results } = await env.LORE_DB.prepare("SELECT kind, item_id, title, price_usd FROM sales").all();
    expect(results).toEqual([{ kind: "publication", item_id: "feed", title: "Feed, 30 days", price_usd: 5 }]);
    const expires = await env.LORE_DB.prepare("SELECT expires_at FROM feed_passes WHERE token = ?1").bind(pass).first<string>("expires_at");
    expect(Date.parse(expires ?? "") - Date.now()).toBeGreaterThan(29 * 86_400_000);
  });

  it("lets get read any piece with the pass, charging nothing, even after the feed is turned off", async () => {
    const pass = await session(subscribe);
    await env.LORE_DB.exec("DELETE FROM sales");
    await feed(null);
    const read = await session((client) => client.callTool({ name: "get", arguments: { id: FIXTURE_PUBLICATION_ID, pass } }));
    expect(read.isError).toBeUndefined();
    expect(JSON.stringify(textOf(read))).toContain("secret owner-approved content");
    expect(textOf(read).feed_pass).toBe(true);
    expect((await env.LORE_DB.prepare("SELECT COUNT(*) AS n FROM sales").first<number>("n")) ?? 0).toBe(0);
  });

  it("asks an expired or unknown pass to pay like anyone else", async () => {
    await env.LORE_DB.exec("CREATE TABLE IF NOT EXISTS feed_passes (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)");
    const expired = `pass_${"e".repeat(32)}`;
    await env.LORE_DB.prepare("INSERT INTO feed_passes VALUES (?1, '2020-01-01T00:00:00Z', '2019-12-01T00:00:00Z')").bind(expired).run();
    for (const pass of [expired, `pass_${"0".repeat(32)}`, "not a pass"]) {
      const result = await session((client) => client.callTool({ name: "get", arguments: { id: FIXTURE_PUBLICATION_ID, pass } }));
      expect(result.isError).toBe(true);
      expect(result._meta?.["x402/error"]).toBeTruthy();
    }
  });

  it("lets discover ask only for what's new since a day", async () => {
    const payload = textOf(await session((client) => client.callTool({ name: "discover", arguments: { since: "2026-01-02" } })));
    const ids = Object.values(payload.topics as Record<string, { id: string }[]>).flat().map((entry) => entry.id);
    expect(ids).not.toContain(FIXTURE_PUBLICATION_ID);
    expect(payload.publication_count).toBe(ids.length);
  });

  it("is named on the store page while it's on", async () => {
    const html = await (await exports.default.fetch(new Request(`${ORIGIN}/`))).text();
    expect(html).toContain("Agents can subscribe: $5.00 for 30 days of everything here.");
    expect(html).toContain("<code>subscribe</code>");
  });
});
