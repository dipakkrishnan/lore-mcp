// MON-044: a collection sells a set of the store's pieces at one price, to agents
// as one paid tool and to people as one page with one card payment.
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/core/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mockFacilitator } from "./facilitator";
import { FIXTURE_PUBLICATION_ID } from "./setup";

const ORIGIN = "https://worker.test";
const ACCOUNT = "acct_1SellerAbc";
const COLLECTION = "2222222222222222aaaaaaaa";
const SECOND = "1111111111111111807ae5f3";
const TOOL = `collection_${COLLECTION}`;

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type PaymentRequired = Parameters<x402Client["createPaymentPayload"]>[0];

const visit = (path: string) => exports.default.fetch(new Request(`${ORIGIN}${path}`));
const textOf = (result: CallToolResult) => JSON.parse((result.content as { text: string }[])[0].text) as Record<string, unknown>;

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-collections-test", version: "0.1.0" });
  const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => exports.default.fetch(input, init)) as typeof fetch;
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: workerFetch }));
  return client;
}

async function pay(challenge: CallToolResult): Promise<string> {
  // A collection costs more than the client's default $1 cap on one payment.
  const paymentClient = x402Client.fromConfig({ schemes: [], spendControls: false });
  registerExactEvmScheme(paymentClient, { signer: toClientEvmSigner(privateKeyToAccount(generatePrivateKey())) });
  return btoa(JSON.stringify(await paymentClient.createPaymentPayload(challenge._meta?.["x402/error"] as PaymentRequired)));
}

beforeAll(async () => {
  await env.LORE_DB.exec(
    "CREATE TABLE IF NOT EXISTS collections (public_id TEXT PRIMARY KEY, title TEXT NOT NULL, price_usd REAL NOT NULL, updated_at TEXT NOT NULL DEFAULT '')"
  );
  await env.LORE_DB.exec(
    "CREATE TABLE IF NOT EXISTS collection_pieces (collection_id TEXT NOT NULL, piece_id TEXT NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(collection_id, piece_id))"
  );
  await env.LORE_DB.exec("CREATE TABLE IF NOT EXISTS node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  await env.LORE_DB.batch([
    env.LORE_DB.prepare("INSERT INTO collections VALUES (?1, 'The Full Shelf', 2, '2026-10-09')").bind(COLLECTION),
    env.LORE_DB.prepare("INSERT INTO collection_pieces VALUES (?1, ?2, 0), (?1, ?3, 1)").bind(COLLECTION, SECOND, FIXTURE_PUBLICATION_ID),
    env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES ('stripe_account', ?1)").bind(ACCOUNT)
  ]);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.LORE_DB.exec("DELETE FROM sales").catch(() => undefined);
  await env.LORE_DB.exec("DELETE FROM card_receipts").catch(() => undefined);
});

afterAll(async () => {
  await env.LORE_DB.exec("DROP TABLE collection_pieces");
  await env.LORE_DB.exec("DROP TABLE collections");
  await env.LORE_DB.prepare("DELETE FROM node_settings WHERE key = 'stripe_account'").run();
});

describe("a collection, to agents", () => {
  it("is listed by discover with its pieces, price and what they cost one by one", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const payload = textOf(await client.callTool({ name: "discover", arguments: {} }));
      expect(payload.collections).toEqual([
        { id: COLLECTION, title: "The Full Shelf", price_usd: 2, pieces: [SECOND, FIXTURE_PUBLICATION_ID], value_usd: 0.02, tool: TOOL }
      ]);
      expect(JSON.stringify(payload)).not.toContain("owner-approved content");
    } finally {
      await client.close();
    }
  });

  it("sells every piece in one payment, in the owner's order, and records one sale", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const challenge = await client.callTool({ name: TOOL, arguments: {} });
      expect(challenge.isError).toBe(true);
      const paid = await client.callTool({ name: TOOL, arguments: {}, _meta: { "x402/payment": await pay(challenge) } });
      expect(paid.isError).toBeUndefined();
      const payload = textOf(paid) as { collection: object; pieces: { id: string; content: string }[] };
      expect(payload.collection).toEqual({ id: COLLECTION, title: "The Full Shelf" });
      expect(payload.pieces.map((piece) => piece.id)).toEqual([SECOND, FIXTURE_PUBLICATION_ID]);
      expect(payload.pieces[1].content).toContain("secret owner-approved content");
      const { results } = await env.LORE_DB.prepare("SELECT kind, item_id, title, price_usd FROM sales").all();
      expect(results).toEqual([{ kind: "publication", item_id: COLLECTION, title: "Collection: The Full Shelf", price_usd: 2 }]);
    } finally {
      await client.close();
    }
  });
});

describe("a collection, to people", () => {
  it("is on the store page and has a page of its own with one card price, never the paid text", async () => {
    expect(await (await visit("/")).text()).toContain(`href="/p/${COLLECTION}"`);
    const html = await (await visit(`/p/${COLLECTION}`)).text();
    expect(html).toContain("The Full Shelf");
    expect(html).toContain("a second teaser");
    expect(html).toContain("Buy for $2.00");
    expect(html).toContain("Worth $0.02 separately");
    expect(html).toContain(TOOL);
    expect(html).not.toContain("owner-approved content");
  });

  it("gives checkout a listing at the collection's price", async () => {
    expect(await (await visit(`/p/${COLLECTION}.json`)).json()).toEqual({
      id: COLLECTION,
      teaser: "The Full Shelf",
      price_usd: 2,
      stripe_account: ACCOUNT,
      test: true
    });
  });

  it("keeps the whole collection as one copy on its card receipt", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ paid: true, piece: COLLECTION, origin: ORIGIN, payment_intent: "pi_set", amount_usd: 2 })
    );
    const html = await (await visit(`/p/${COLLECTION}?session_id=cs_test_set`)).text();
    expect(html).toContain("<h2>Second Fixture</h2>");
    expect(html).toContain("secret owner-approved content");
    const { results } = await env.LORE_DB.prepare("SELECT piece_id, kind FROM card_receipts").all();
    expect(results).toEqual([{ piece_id: COLLECTION, kind: "collection" }]);
    const sale = await env.LORE_DB.prepare("SELECT item_id, title, price_usd FROM sales WHERE network = 'stripe'").first();
    expect(sale).toEqual({ item_id: COLLECTION, title: "Collection: The Full Shelf", price_usd: 2 });
  });
});
