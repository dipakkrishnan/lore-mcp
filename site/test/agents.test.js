import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test, vi } from "vitest";
import { catalog, openBids } from "../src/agents.js";
import { Exchange } from "../src/markets.js";
import worker, { marketPage, marketplacePage } from "../src/worker.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const SET = "cccccccccccccccccccccccc";
const seller = {
  name: "Dipak",
  node: "https://lore.example.workers.dev/mcp",
  store: "https://lore.example.workers.dev/",
  network: "eip155:8453",
  price_usd: 1,
  listed: "2026-09-15",
  listings: [
    { market: "learning-to-dive", piece: A },
    { market: "learning-to-dive", piece: B },
    { market: "learning-to-dive", piece: SET }
  ]
};
const registry = { markets: [{ id: "learning-to-dive", name: "Learning to scuba dive", tab: "Travel" }], sellers: [seller] };
const store = {
  price_usd: 1,
  topics: {
    diving: [
      { id: A, teaser: "When should a new diver skip a dive?", sample: "Bonaire gave me a foundation.", useful_if: "You're planning a first trip.", not_useful_if: "You're already certified.", updated_at: "2026-10-22" },
      { id: B, teaser: "Which drills mattered most?", updated_at: "2026-10-01" }
    ]
  },
  collections: [{ id: SET, title: "Everything on diving", price_usd: 3, pieces: [A, B] }]
};
const lines = (text) => text.trim().split("\n").map((line) => JSON.parse(line));
const exchange = () => Exchange.load(registry, async () => store);
const bids = () => env.BIDS.get(env.BIDS.idFromName("book"));
const pass = { limit: async () => ({ success: true }) };
const ADMIN = { authorization: "Bearer test-admin-token", "content-type": "application/json" };

afterEach(() => vi.restoreAllMocks());

/** The Worker with the registry and a store stubbed, and the bid book only when `withBids`. */
function serve(path, { withBids = false, init } = {}) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).includes("lore-marketplace")) return Response.json(registry);
    const body = JSON.parse(init.body);
    if (body.method === "tools/call") return Response.json({ result: { content: [{ type: "text", text: JSON.stringify(store) }] } });
    return Response.json({}, { headers: { "mcp-session-id": "s1" } });
  });
  const assets = { fetch: async () => new Response("<!doctype html>home") };
  const book = withBids ? { BIDS: env.BIDS, BIDS_ADMIN_TOKEN: env.BIDS_ADMIN_TOKEN, BID_RATE_LIMIT: pass, BID_GLOBAL_RATE_LIMIT: pass } : {};
  return worker.fetch(new Request(`https://yourlore.dev${path}`, init), { ASSETS: assets, ...book }, { waitUntil() {} });
}

test("lists every piece the marketplace page shows, from the same exchange, with nothing extra", async () => {
  const loaded = await exchange();
  const html = marketplacePage(loaded);
  const listed = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]).itemListElement.map((e) => e.item.url);
  expect(lines(catalog(loaded)).map((r) => r.url)).toEqual(listed);
  for (const record of lines(catalog(loaded))) expect(marketPage(loaded, record.market).includes(record.url)).toBe(true);
});

test("each line carries what an agent needs to judge and buy the piece", async () => {
  const [piece, other, set] = lines(catalog(await exchange()));
  expect(piece).toEqual({
    type: "piece",
    id: A,
    market: "learning-to-dive",
    market_name: "Learning to scuba dive",
    seller: "Dipak",
    title: "When should a new diver skip a dive?",
    price_usd: 1,
    useful_if: "You're planning a first trip.",
    not_useful_if: "You're already certified.",
    sample: "Bonaire gave me a foundation.",
    url: `https://lore.example.workers.dev/p/${A}`,
    json: `https://lore.example.workers.dev/p/${A}.json`,
    node: "https://lore.example.workers.dev/mcp",
    test: false,
    updated: "2026-10-22"
  });
  expect(other.type).toBe("piece");
  expect([set.type, set.pieces, set.price_usd]).toEqual(["collection", 2, 3]);
});

test("serves /marketplace.jsonl as JSON lines anyone can fetch", async () => {
  const response = await serve("/marketplace.jsonl");
  expect(response.headers.get("content-type")).toBe("application/jsonl; charset=utf-8");
  expect(response.headers.get("access-control-allow-origin")).toBe("*");
  expect(lines(await response.text()).length).toBe(3);
});

test("adds open bids through the bids route only once the BIDS binding exists, keeping private fields out", async () => {
  await runInDurableObject(bids(), (_instance, state) => state.storage.sql.exec("DELETE FROM bid_events; DELETE FROM bids; DELETE FROM meta"));
  const place = async (fields) => (await (await serve("/bids", { withBids: true, init: { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ usd: 20, market: "learning-to-dive", ...fields }) } })).json()).id;
  const open = await place({ question: "How do you stop reward hacking on long coding tasks?" });
  const answered = await place({ question: "Which drills mattered most on a first dive trip?", email: "me@example.com", callback_url: "https://agent.example.com/hook" });
  const answer = { handle: "dipak", piece_url: `https://lore.example.workers.dev/p/${A}`, preview: "Pin the grader first.", usd: 20 };
  expect((await serve(`/b/${answered}/answers`, { withBids: true, init: { method: "POST", headers: ADMIN, body: JSON.stringify(answer) } })).ok).toBe(true);
  const without = lines(await (await serve("/marketplace.jsonl")).text());
  expect(without.filter((r) => r.type === "bid")).toHaveLength(0);
  const withBids = lines(await (await serve("/marketplace.jsonl", { withBids: true })).text()).filter((r) => r.type === "bid");
  expect(Object.fromEntries(withBids.map((r) => [r.id, [r.status, r.answers]]))).toEqual({ [open]: ["open", 0], [answered]: ["answered", 1] });
  for (const record of withBids) expect(Object.keys(record).sort()).toEqual(["answers", "created", "expires", "id", "json", "market", "question", "status", "type", "url", "usd"]);
  expect(withBids.find((r) => r.id === open).json).toBe(`https://yourlore.dev/b/${open}.json`);
});

test("a bids route that fails or isn't there yet leaves the catalog whole", async () => {
  expect(await openBids({ BIDS: {} }, async () => new Response("<!doctype html>", { status: 200 }))).toEqual([]);
  expect(await openBids({ BIDS: {} }, async () => new Response("no", { status: 404 }))).toEqual([]);
  expect(await openBids({}, async () => expect.unreachable("read without a binding"))).toEqual([]);
});

test("/llms.txt and /robots.txt are text, not the home page", async () => {
  const llms = await serve("/llms.txt");
  expect(llms.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  const text = await llms.text();
  expect(text).toMatch(/^# Lore\n/);
  expect(text).toMatch(/never sells facts about a person, raw chats or notes, or anything its seller hasn't approved/);
  expect(text).toMatch(/https:\/\/yourlore\.dev\/marketplace\.jsonl/);
  expect(text).toMatch(/lore-buy/);
  expect(text).not.toMatch(/bids/i);
  expect(text.split("\n").length <= 20).toBe(true);
  expect(await (await serve("/llms.txt", { withBids: true })).text()).toMatch(/POST https:\/\/yourlore\.dev\/bids with question/);
  const robots = await (await serve("/robots.txt")).text();
  expect(robots).toMatch(/^User-agent: \*\nAllow: \/\n/);
  expect(robots).toMatch(/Sitemap: https:\/\/yourlore\.dev\/sitemap\.xml/);
  expect(robots).toMatch(/https:\/\/yourlore\.dev\/llms\.txt/);
});

test("/sitemap.xml covers home, the markets, each market and each piece", async () => {
  const response = await serve("/sitemap.xml");
  expect(response.headers.get("content-type")).toBe("application/xml; charset=utf-8");
  const locs = [...(await response.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  expect(locs.slice(0, 3)).toEqual(["https://yourlore.dev/", "https://yourlore.dev/marketplace", "https://yourlore.dev/marketplace/learning-to-dive"]);
  expect(locs.includes(`https://lore.example.workers.dev/p/${A}`)).toBe(true);
});

test("each market has a JSON twin its page links to", async () => {
  const loaded = await exchange();
  expect(marketPage(loaded, "learning-to-dive")).toMatch(/<link rel="alternate" type="application\/json" href="https:\/\/yourlore\.dev\/marketplace\/learning-to-dive\.json">/);
  expect(marketplacePage(loaded)).toMatch(/<link rel="alternate" type="application\/json" href="https:\/\/yourlore\.dev\/marketplace\.json"><link rel="alternate" type="application\/jsonl" href="https:\/\/yourlore\.dev\/marketplace\.jsonl">/);
  const twin = await (await serve("/marketplace/learning-to-dive.json")).json();
  expect(twin.pieces.length).toBe(3);
  expect(twin.pieces[0].id).toBe(A);
  expect((await serve("/marketplace/nowhere.json")).status).toBe(404);
  expect((await (await serve("/marketplace/stats.json")).json()).pieces).toBe(3);
});

test("other paths still fall through to the static site", async () => {
  expect(await (await serve("/anything")).text()).toBe("<!doctype html>home");
});
