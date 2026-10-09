// MON-045: a feed sells agents a 30-day pass to every piece; get honours the pass without payment.
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/core/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { type PrivateKeyAccount, generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockFacilitator } from "./facilitator";
import { FIXTURE_PUBLICATION_ID } from "./setup";

const ORIGIN = "https://worker.test";
const ACCOUNT = "acct_1SellerAbc";
const FEED_ID = ((body) => body + createHash("sha256").update(body).digest("hex").slice(0, 8))("3333333333333333");
const buyer = privateKeyToAccount(generatePrivateKey());

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

const visit = (path: string, cookie?: string) =>
  exports.default.fetch(new Request(`${ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined));
const setting = (key: string, value: string | null) =>
  value === null
    ? env.LORE_DB.prepare("DELETE FROM node_settings WHERE key = ?1").bind(key).run()
    : env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES (?1, ?2)").bind(key, value).run();

async function signed(account: PrivateKeyAccount, pass: string, signedAt = new Date().toISOString()) {
  const message = `Lore pass ${pass} for ${FIXTURE_PUBLICATION_ID} at ${signedAt}`;
  return { id: FIXTURE_PUBLICATION_ID, pass, signed_at: signedAt, signature: await account.signMessage({ message }) };
}

async function pay(challenge: CallToolResult): Promise<string> {
  // A pass costs more than the client's default $1 cap on one payment.
  const paymentClient = x402Client.fromConfig({ schemes: [], spendControls: false });
  registerExactEvmScheme(paymentClient, { signer: toClientEvmSigner(buyer) });
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
  await env.LORE_DB.exec("DELETE FROM card_receipts").catch(() => undefined);
  await env.LORE_DB.exec("DELETE FROM feed_browsers").catch(() => undefined);
  await setting("feed_id", null);
  await setting("stripe_account", null);
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

  it("sells a 30-day pass in one payment, tied to the wallet that paid, and records one feed sale", async () => {
    const pass = await subscribe(await connect());
    expect(pass).toMatch(/^pass_[0-9a-f]{32}$/);
    const { results } = await env.LORE_DB.prepare("SELECT kind, item_id, title, price_usd FROM sales").all();
    expect(results).toEqual([{ kind: "feed", item_id: "feed", title: "Feed, 30 days", price_usd: 5 }]);
    const row = await env.LORE_DB.prepare("SELECT expires_at, payer FROM feed_passes WHERE token = ?1").bind(pass).first<{ expires_at: string; payer: string }>();
    expect(Date.parse(row?.expires_at ?? "") - Date.now()).toBeGreaterThan(29 * 86_400_000);
    expect(row?.payer.toLowerCase()).toBe(buyer.address.toLowerCase());
  });

  it("lets the paying wallet read any piece with the pass, charging nothing, even after the feed is turned off", async () => {
    const pass = await session(subscribe);
    await env.LORE_DB.exec("DELETE FROM sales");
    await feed(null);
    const read = await session(async (client) => client.callTool({ name: "get", arguments: await signed(buyer, pass) }));
    expect(read.isError).toBeUndefined();
    expect(JSON.stringify(textOf(read))).toContain("secret owner-approved content");
    expect(textOf(read).feed_pass).toBe(true);
    expect((await env.LORE_DB.prepare("SELECT COUNT(*) AS n FROM sales").first<number>("n")) ?? 0).toBe(0);
  });

  it("asks a pass that is leaked, unsigned, stale, expired or unknown to pay like anyone else, and says why", async () => {
    const pass = await session(subscribe);
    const expired = `pass_${"e".repeat(32)}`;
    await env.LORE_DB.prepare("INSERT INTO feed_passes(token,expires_at,created_at,payer) VALUES (?1, '2020-01-01T00:00:00Z', '2019-12-01T00:00:00Z', ?2)")
      .bind(expired, buyer.address)
      .run();
    const stranger = privateKeyToAccount(generatePrivateKey());
    const cases: [Record<string, string>, string][] = [
      [await signed(stranger, pass), "belongs to another wallet"],
      [{ id: FIXTURE_PUBLICATION_ID, pass }, "must be signed by the wallet that bought it"],
      [await signed(buyer, pass, new Date(Date.now() - 20 * 60_000).toISOString()), "within 10 minutes"],
      [await signed(buyer, expired), "run out"],
      [await signed(buyer, `pass_${"0".repeat(32)}`), "run out"],
      [{ id: FIXTURE_PUBLICATION_ID, pass: "not a pass" }, "isn't a pass"]
    ];
    for (const [args, why] of cases) {
      const result = await session((client) => client.callTool({ name: "get", arguments: args }));
      expect(result.isError).toBe(true);
      expect(result._meta?.["x402/error"]).toBeTruthy();
      expect(JSON.stringify(result.content)).toContain(why);
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
    expect(html).toContain("Subscribe for $5.00: 30 days of everything here, old and new.");
    expect(html).toContain("<code>subscribe</code>");
  });
});

describe("a feed, to people paying by card", () => {
  const paid = () =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ paid: true, piece: FEED_ID, origin: ORIGIN, payment_intent: "pi_feed", amount_usd: 5 })
    );
  const cookieOf = (response: Response) => response.headers.get("set-cookie")?.split(";")[0] ?? "";

  beforeEach(async () => {
    await setting("feed_id", FEED_ID);
    await setting("stripe_account", ACCOUNT);
  });

  it("has a subscribe page, linked from the store, and a listing checkout charges at the feed's price", async () => {
    expect(await (await visit("/")).text()).toContain(`href="/p/${FEED_ID}"`);
    const html = await (await visit(`/p/${FEED_ID}`)).text();
    expect(html).toContain("Subscribe for $5.00");
    expect(html).not.toContain("owner-approved content");
    expect(await (await visit(`/p/${FEED_ID}.json`)).json()).toEqual({
      id: FEED_ID,
      teaser: "This store feed: 30 days of everything",
      price_usd: 5,
      stripe_account: ACCOUNT,
      test: true
    });
    await feed(null);
    expect((await visit(`/p/${FEED_ID}.json`)).status).toBe(404);
  });

  it("opens every piece for 30 days, only in the browser that first opened it, and records one feed sale", async () => {
    paid();
    const first = await visit(`/p/${FEED_ID}?session_id=cs_test_feed`);
    expect(first.status).toBe(200);
    expect(await first.text()).toContain("secret owner-approved content");
    const cookie = cookieOf(first);
    expect(cookie).toMatch(/^lore_feed=browser_[0-9a-f]{32}$/);
    expect(first.headers.get("set-cookie")).toContain(`Path=/p/${FEED_ID}`);
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");

    const elsewhere = await visit(`/p/${FEED_ID}?session_id=cs_test_feed`);
    expect(elsewhere.status).toBe(403);
    expect(await elsewhere.text()).toContain("This subscription opens in the browser it was bought in.");

    await feed(null);
    const again = await visit(`/p/${FEED_ID}?session_id=cs_test_feed`, cookie);
    expect(await again.text()).toContain("secret owner-approved content");

    const { results } = await env.LORE_DB.prepare("SELECT kind, item_id, title, price_usd FROM sales WHERE network = 'stripe'").all();
    expect(results).toEqual([{ kind: "feed", item_id: FEED_ID, title: "Feed, 30 days", price_usd: 5 }]);
  });

  it("says when the 30 days are over and offers to subscribe again", async () => {
    paid();
    const cookie = cookieOf(await visit(`/p/${FEED_ID}?session_id=cs_test_feed`));
    await env.LORE_DB.prepare("UPDATE card_receipts SET bought_at = ?1").bind(new Date(Date.now() - 31 * 86_400_000).toISOString()).run();
    const html = await (await visit(`/p/${FEED_ID}?session_id=cs_test_feed`, cookie)).text();
    expect(html).toContain("Your 30 days ended.");
    expect(html).toContain("Subscribe for $5.00");
    expect(html).not.toContain("secret owner-approved content");
  });

  it("counts a subscription checkout reports, before the buyer comes back", async () => {
    paid();
    const form = new FormData();
    form.set("session_id", "cs_test_feed");
    const response = await exports.default.fetch(new Request(`${ORIGIN}/p/${FEED_ID}/paid`, { method: "POST", body: form }));
    expect(await response.json()).toEqual({ recorded: true });
    const kept = await env.LORE_DB.prepare("SELECT kind FROM card_receipts WHERE session_id = 'cs_test_feed'").first<string>("kind");
    expect(kept).toBe("feed");
  });
});
