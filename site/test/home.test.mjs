import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { homePage } from "../src/home.js";
import { Exchange } from "../src/markets.js";

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const seller = { name: "Dipak", node: "https://lore.example.workers.dev/mcp", store: "https://lore.example.workers.dev/", network: "eip155:8453", price_usd: 1 };
const registry = {
  markets: [{ id: "learning-to-dive", name: "Learning to scuba dive", tab: "Travel" }, { id: "rl-evals", name: "RL evals", tab: "Agents and AI" }],
  sellers: [{ ...seller, listings: [{ market: "learning-to-dive", piece: A }, { market: "rl-evals", piece: A }] }]
};
const catalog = { price_usd: 1, topics: { diving: [{ id: A, teaser: "When should a new diver skip a dive?", sample: "Bonaire gave me a foundation.", updated_at: "2026-10-22" }] } };
const load = (list) => Exchange.load(list, async () => catalog);
const bid = (id, usd, extra = {}) => ({ id, url: `https://yourlore.dev/b/${id}`, question: `Question ${id} worth asking?`, usd, market: "rl-evals", status: "open", created: "2026-10-31T22:10:00Z", ...extra });
const reply = (bids) => async () => Response.json({ bids });
const render = (sources) => homePage(page, { registry: async () => registry, load, ...sources });
const cards = (html) => (html.match(/<li class="card">/g) ?? []).length;

test("the static page carries no example of its own: the slot is empty until the Worker fills it", () => {
  assert.match(page, /<!-- examples --><!-- \/examples -->/);
  assert.equal(cards(page), 0);
  assert.doesNotMatch(page, /sync placement|ops layer|Raise the first price/);
  assert.doesNotMatch(page, /mainnet|x402|stablecoin|\bnode\b|Markets</i);
});

test("shows the three biggest open bids, with their market and amount", async () => {
  const bids = [bid("small", 5), bid("big", 50), bid("mid", 20), bid("next", 10), bid("taken", 90, { status: "answered" })];
  const html = await render({ bids: reply(bids) });
  assert.equal(cards(html), 3);
  assert.match(html, /People are bidding on/);
  assert.deepEqual([...html.matchAll(/href="https:\/\/yourlore\.dev\/b\/(\w+)"/g)].map((m) => m[1]), ["big", "mid", "next"]);
  assert.match(html, /<small>RL evals<\/small>/);
  assert.match(html, /<span class="tag">Offers \$50<\/span>/);
  assert.doesNotMatch(html, /When should a new diver/);
});

test("falls back to real listed pieces when there are no open bids", async () => {
  for (const bids of [reply([]), reply([bid("taken", 90, { status: "filled" })])]) {
    const html = await render({ bids });
    assert.match(html, /On the Marketplace now/);
    // Listed in two markets, the piece still shows once.
    assert.equal(cards(html), 1);
    assert.match(html, /href="https:\/\/lore\.example\.workers\.dev\/p\/aaaaaaaaaaaaaaaaaaaaaaaa"/);
    assert.match(html, /<q>Bonaire gave me a foundation\.<\/q>/);
    assert.match(html, /<span class="tag">\$1<\/span>/);
  }
});

test("falls back to pieces when the bids can't be read, including before the bids route exists", async () => {
  const failures = [async () => new Response(page, { headers: { "content-type": "text/html" } }), async () => new Response("", { status: 500 }), async () => { throw new Error("down"); }];
  for (const bids of failures) assert.match(await render({ bids }), /On the Marketplace now/);
});

test("leaves the block out, never empty, when there is nothing real to show", async () => {
  const none = reply([]);
  for (const html of [
    await homePage(page, { bids: none, registry: async () => { throw new Error("down"); }, load }),
    await homePage(page, { bids: none, registry: async () => registry, load: (list) => Exchange.load(list, async () => null) }),
    await homePage(page, { bids: none, registry: async () => ({ ...registry, sellers: [{ ...registry.sellers[0], network: "eip155:84532" }] }), load })
  ]) {
    assert.doesNotMatch(html, /class="window"|<!-- examples -->/);
    assert.equal(cards(html), 0);
  }
});

test("draws bids even when the Marketplace list is down, and escapes what buyers wrote", async () => {
  const html = await homePage(page, {
    bids: reply([bid("x", 10, { question: "<script>alert(1)</script> is it safe?" }), bid("bad", 10, { url: "javascript:alert(1)" })]),
    registry: async () => { throw new Error("down"); },
    load
  });
  assert.equal(cards(html), 1);
  assert.doesNotMatch(html, /<script>alert|javascript:/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; is it safe\?/);
});

test("the Worker serves the filled-in home page at /", async (t) => {
  const { default: worker } = await import("../src/worker.js");
  t.mock.method(globalThis, "fetch", async () => Response.json({ markets: [], sellers: [] }));
  const assets = { fetch: async () => new Response(page, { headers: { "content-type": "text/html" } }) };
  const response = await worker.fetch(new Request("https://yourlore.dev/"), { ASSETS: assets });
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  const html = await response.text();
  assert.match(html, /Keep what your AI learns about you/);
  assert.doesNotMatch(html, /<!-- examples -->/);
});
