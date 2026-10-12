// Free first copies (MON-040): the page and `get` give a piece's first copies away,
// count them atomically per piece, and fall back to the paid path once they are gone.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { newTicketId } from "../src/answer-state";
import { mockFacilitator } from "./facilitator";
import { FIXTURE_PUBLICATION_ID } from "./setup";

const ORIGIN = "https://worker.test";
const PIECE = `/p/${FIXTURE_PUBLICATION_ID}`;
const SECRET = "the secret owner-approved content";

const visit = (path: string, init: RequestInit = {}) => exports.default.fetch(new Request(`${ORIGIN}${path}`, init));
const take = (cookie?: string) => visit(`${PIECE}/free`, { method: "POST", headers: cookie ? { cookie } : {}, redirect: "manual" });
const page = async () => (await visit(PIECE)).text();

const setCopies = (copies: string) =>
  env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES ('free_copies', ?1)").bind(copies).run();

const given = async () =>
  (await env.LORE_DB.prepare("SELECT item_id, title, price_usd, network, payer, refund_owed FROM sales WHERE network = 'free'").all()).results;

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-free-test", version: "0.1.0" });
  const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => exports.default.fetch(input, init)) as typeof fetch;
  await client.connect(new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), { fetch: workerFetch }));
  return client;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  JSON.parse((result.content as { text: string }[])[0].text) as Record<string, unknown>;

beforeEach(async () => {
  await env.LORE_DB.exec("CREATE TABLE IF NOT EXISTS node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  await setCopies("3");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await env.LORE_DB.prepare("DELETE FROM node_settings WHERE key = 'free_copies'").run();
  await env.LORE_DB.exec("DELETE FROM sales").catch(() => undefined);
  await env.LORE_DB.exec("DELETE FROM card_receipts").catch(() => undefined);
});

describe("a piece page with free copies", () => {
  it("offers a free read first, and counts down as copies go", async () => {
    let html = await page();
    expect(html).toContain("Read free");
    expect(html).toContain("3 of 3 free copies left");
    expect(html).not.toContain("Buy it with your AI agent");
    expect(html).toContain("the first 3 copies of each piece are free");
    await take();
    expect(await page()).toContain("2 of 3 free copies left");
    await take();
    await take();
    html = await page();
    expect(html).not.toContain("Read free");
    expect(html).toContain("Buy it with your AI agent");
  });

  it("gives a copy under a link that keeps opening it, and records it as a $0 sale", async () => {
    const response = await take();
    expect(response.status).toBe(303);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const link = response.headers.get("location")!;
    expect(link).toMatch(new RegExp(`^${PIECE}\\?session_id=free_[0-9a-f]{32}$`));
    expect(response.headers.get("set-cookie")).toContain(`Path=${PIECE}`);
    for (let opening = 0; opening < 2; opening++) {
      const copy = await visit(link);
      expect(copy.headers.get("cache-control")).toBe("private, no-store");
      const html = await copy.text();
      expect(html).toContain(SECRET);
      expect(html).toContain("This copy is free, from the seller.");
    }
    expect(await given()).toEqual([
      { item_id: FIXTURE_PUBLICATION_ID, title: "Fixture Publication", price_usd: 0, network: "free", payer: "", refund_owed: 0 }
    ]);
  });

  it("sends a browser back to the copy it already took instead of spending another", async () => {
    const first = await take();
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    const again = await take(cookie);
    expect(again.headers.get("location")).toBe(first.headers.get("location"));
    expect(await given()).toHaveLength(1);
  });

  it("never gives more than the setting, even when readers claim at once", async () => {
    const responses = await Promise.all(Array.from({ length: 6 }, () => take()));
    expect(responses.filter((response) => response.status === 303)).toHaveLength(3);
    expect(await given()).toHaveLength(3);
    const late = responses.find((response) => response.status === 200)!;
    const html = await late.text();
    expect(html).toContain("There are no free copies of this piece left.");
    expect(html).not.toContain(SECRET);
  });

  it("opens nothing for a made-up free link", async () => {
    const html = await (await visit(`${PIECE}?session_id=free_${"0".repeat(32)}`)).text();
    expect(html).not.toContain(SECRET);
    expect(html).toContain("This link doesn&#39;t open a free copy here.");
  });

  it("gives nothing when the owner turned free copies off", async () => {
    await setCopies("0");
    expect(await page()).not.toContain("Read free");
    expect((await take()).status).toBe(200);
    expect(await given()).toEqual([]);
  });
});

describe("get with free copies", () => {
  it("returns the piece without payment and says so, then asks for payment once they are gone", async () => {
    const facilitator = mockFacilitator();
    const client = await connect();
    try {
      for (let copy = 0; copy < 3; copy++) {
        const result = await client.callTool({ name: "get", arguments: { id: FIXTURE_PUBLICATION_ID } });
        expect(result.isError).toBeUndefined();
        expect(result._meta?.["x402/payment-response"]).toBeUndefined();
        const payload = textOf(result);
        expect(payload.free_copy).toBe(true);
        expect((payload.publication as { content: string }).content).toContain(SECRET);
      }
      const paid = await client.callTool({ name: "get", arguments: { id: FIXTURE_PUBLICATION_ID } });
      expect(paid.isError).toBe(true);
      expect(paid._meta?.["x402/error"]).toBeTruthy();
      expect(await given()).toHaveLength(3);
      const asked = facilitator.mock.calls.map(([input, init]) => new URL(new Request(input, init).url).pathname);
      expect(asked.filter((path) => path === "/verify" || path === "/settle")).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("shares the count with the page, and advertises the setting in discover", async () => {
    mockFacilitator();
    await take();
    await take();
    const client = await connect();
    try {
      expect(textOf(await client.callTool({ name: "discover", arguments: {} })).free_copies).toBe(3);
      expect(textOf(await client.callTool({ name: "get", arguments: { id: FIXTURE_PUBLICATION_ID } })).free_copy).toBe(true);
      expect((await client.callTool({ name: "get", arguments: { id: FIXTURE_PUBLICATION_ID } }))._meta?.["x402/error"]).toBeTruthy();
    } finally {
      await client.close();
    }
  });

  it("asks for payment for an unknown piece without spending a copy", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const result = await client.callTool({ name: "get", arguments: { id: newTicketId() } });
      expect(result._meta?.["x402/error"]).toBeTruthy();
      expect(await given()).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
