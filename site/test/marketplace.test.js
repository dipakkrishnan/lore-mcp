import { afterEach, expect, test, vi } from "vitest";
import { STYLE } from "../src/layout.js";
import { Exchange, Store } from "../src/markets.js";
import worker, { marketPage, marketplacePage } from "../src/worker.js";

afterEach(() => vi.restoreAllMocks());

const A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccc";
const seller = { name: "Dipak", node: "https://lore.example.workers.dev/mcp", store: "https://lore.example.workers.dev/", network: "eip155:8453", topics: ["diving"], publications: 2, price_usd: 1, listed: "2026-09-15" };
const catalog = {
  price_usd: 1,
  topics: {
    diving: [
      { id: A, teaser: "When should a new diver skip a dive?", sample: "Bonaire gave me a foundation.", useful_if: "You're planning a first trip.", updated_at: "2026-10-22" },
      { id: B, teaser: "Which drills mattered most?", updated_at: "2026-10-01" }
    ]
  }
};
const list = (sellers, markets = [{ id: "learning-to-dive", name: "Learning to scuba dive", tab: "Travel" }]) => ({ markets, sellers });
const load = (registry, read = async () => catalog) => Exchange.load(registry, read);

test("fills a market with the pieces listed in it, in the store's own words and price", async () => {
  const exchange = await load(list([{ ...seller, listings: [{ market: "learning-to-dive", piece: A }, { market: "learning-to-dive", piece: B }] }]));
  const html = marketplacePage(exchange);
  expect(html).toMatch(/Learning to scuba dive/);
  expect(html).toMatch(/When should a new diver skip a dive\?/);
  expect(html).toMatch(/href="https:\/\/lore\.example\.workers\.dev\/p\/aaaaaaaaaaaaaaaaaaaaaaaa"/);
  expect(html).toMatch(/<a class="line" href="https:\/\/lore\.example\.workers\.dev\/p\/aaaaaaaaaaaaaaaaaaaaaaaa"><span class="amt">\$1<\/span><span class="q">When should a new diver skip a dive\?<\/span><span class="side"><span class="mk">Learning to scuba dive<\/span><span>Dipak<\/span><span>Updated Oct 22<\/span><\/span><\/a>/);
  expect(html).toMatch(/<b data-stat="markets" aria-label="1">1<\/b>market<\/li><li><b data-stat="pieces" aria-label="2">2<\/b>pieces/);
  expect(html).not.toMatch(/class="lede"/);
});

test("shows only real listings: unknown markets, unsold pieces and silent stores leave nothing behind", async () => {
  const listings = [{ market: "learning-to-dive", piece: C }, { market: "no-such-market", piece: A }];
  expect(marketplacePage(await load(list([{ ...seller, listings }])))).toMatch(/No market has a listing yet/);
  const silent = await load(list([{ ...seller, listings: [{ market: "learning-to-dive", piece: A }] }]), async () => null);
  expect(silent.markets.length).toBe(0);
  expect(marketplacePage(silent)).toMatch(/Visit store/);
});

test("escapes what sellers and the registry wrote", async () => {
  const exchange = await load(
    list([{ ...seller, name: "<b>Dipak</b>", listings: [{ market: "learning-to-dive", piece: A }] }], [{ id: "learning-to-dive", name: "<i>Dive</i>", tab: "Travel" }]),
    async () => ({ topics: { x: [{ id: A, teaser: "<script>alert(1)</script>", updated_at: "2026-10-22" }] } })
  );
  const html = marketplacePage(exchange) + marketPage(exchange, "learning-to-dive");
  expect(html).not.toMatch(/<script>alert|<i>Dive|<b>Dipak/);
  expect(html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("drops sellers and markets that aren't well formed", async () => {
  const exchange = await load(
    list(
      [
        { ...seller, listings: [{ market: "learning-to-dive", piece: A }] },
        { ...seller, name: "Script", store: "javascript:alert(1)", listings: [{ market: "learning-to-dive", piece: B }] },
        { ...seller, name: "No price", price_usd: "1", listings: [] }
      ],
      [{ id: "learning-to-dive", name: "Learning to scuba dive", tab: "Travel" }, { id: "Bad Slug", name: "x", tab: "y" }, { id: "no-tab", name: "x" }]
    )
  );
  expect(exchange.sellers.map((s) => s.name)).toEqual(["Dipak"]);
  expect(exchange.markets.map((m) => m.id)).toEqual(["learning-to-dive"]);
});

const two = async () => {
  const markets = [
    { id: "learning-to-dive", name: "Learning to scuba dive", tab: "Travel" },
    { id: "soccer-tactics", name: "Soccer tactics", tab: "Sports" }
  ];
  const shane = { ...seller, name: "Shane", node: "https://shane.example.workers.dev/mcp", store: "https://shane.example.workers.dev/", network: "eip155:84532", listings: [{ market: "soccer-tactics", piece: C }] };
  return load(list([{ ...seller, listings: [{ market: "learning-to-dive", piece: A }, { market: "learning-to-dive", piece: B }] }, shane], markets), async (s) =>
    s.name === "Shane" ? { topics: { soccer: [{ id: C, teaser: "How should wingers play?", updated_at: "2026-11-01" }] } } : catalog
  );
};
const rows = (html) => [...html.matchAll(/<a class="line" href="[^"]*\/p\/([a-z])/g)].map(([, piece]) => piece);

test("the markets are one list of rows, newest first, with each market as a text tab", async () => {
  const html = marketplacePage(await two());
  expect(rows(html)).toEqual(["c", "a", "b"]);
  expect(html).toMatch(/<span class="mk">Soccer tactics<\/span><span>Shane · test store<\/span>/);
  expect(html).toMatch(/<nav class="tabs" aria-label="Markets"><ul><li><a href="\/marketplace" class="on" aria-current="page">All<small>3<\/small><\/a><\/li><li><a href="\/marketplace\/learning-to-dive">Learning to scuba dive<small>2<\/small><\/a><\/li><li><a href="\/marketplace\/soccer-tactics">Soccer tactics<small>1<\/small><\/a><\/li><\/ul><\/nav>/);
  expect(html).not.toMatch(/class="(card|grid|rows|row|pill|tape|offer)"|<select|section class="tab"|data-live="latest"/);
});

test("a search and a seller each narrow the rows, and work without a script", async () => {
  const exchange = await two();
  expect(rows(marketplacePage(exchange, { q: "wingers" }))).toEqual(["c"]);
  expect(rows(marketplacePage(exchange, { q: "bonaire" }))).toEqual(["a"]);
  expect(rows(marketplacePage(exchange, { seller: "shane" }))).toEqual(["c"]);
  expect(marketplacePage(exchange, { seller: "shane" })).toMatch(/<input type="hidden" name="seller" value="shane">/);
  expect(marketplacePage(exchange, { q: "nothing like this" })).toMatch(/<p class="empty none">Nothing here matches/);
  expect(marketplacePage(exchange)).toMatch(/<p class="empty none" hidden>/);
  expect(marketplacePage(exchange)).toMatch(/data-search="learning to scuba dive travel when should a new diver skip a dive\? bonaire gave me a foundation\. you&#39;re planning a first trip\. dipak"/);
});

test("a market's page is the same list, narrowed to it, with its tab lit and its own fixed counts", async () => {
  const exchange = await two();
  const html = marketPage(exchange, "learning-to-dive");
  expect(rows(html)).toEqual(["a", "b"]);
  expect(html).toMatch(/<li><a href="\/marketplace\/learning-to-dive" class="on" aria-current="page">Learning to scuba dive<small>2<\/small>/);
  expect(html).toMatch(/<li><a href="\/marketplace">All<small>3<\/small>/);
  expect(html).toMatch(/<li><b>2<\/b>pieces<\/li><li><b>1<\/b>seller<\/li><li><b>\$1<\/b>lowest price<\/li>/);
  expect(html).not.toMatch(/data-stat=/);
  expect(html).toMatch(/<form class="search" method="get" action="\/marketplace\/learning-to-dive"/);
  expect(html).not.toMatch(/class="(card|grid|offers|offer|related)"|<blockquote>|View &amp; buy/);
  expect(rows(marketPage(exchange, "learning-to-dive", { q: "drills" }))).toEqual(["b"]);
  expect(marketPage(exchange, "nowhere")).toMatch(/No market by that name has a listing/);
});

test("searches inside a market on the server at /marketplace/:id?q=", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(list([{ ...seller, listings: [{ market: "learning-to-dive", piece: A }, { market: "learning-to-dive", piece: B }] }]))));
  vi.spyOn(Store.prototype, "catalog").mockResolvedValue(catalog);
  const response = await worker.fetch(new Request("https://yourlore.dev/marketplace/learning-to-dive?q=drills"), {});
  expect(response.status).toBe(200);
  const html = await response.text();
  expect(rows(html)).toEqual(["b"]);
  expect(html).toMatch(/name="q" value="drills"/);
});

test("the site's style no longer carries the card grid", () => {
  expect(STYLE).not.toMatch(/\.(card|grid|rows|pill|glyph|tape|who|foot-row|related)\b/);
  expect(STYLE).not.toMatch(/\.tabs (form|select|button)/);
  expect(STYLE).toMatch(/\.line\{/);
});

test("survives a registry that can't be loaded or isn't shaped like one", async () => {
  expect(marketplacePage(null)).toMatch(/can't be loaded right now/);
  expect(marketplacePage(await load({ sellers: {}, markets: "x" }))).toMatch(/No market has a listing yet/);
});

test("reads a store's catalog over MCP the way an agent does", async () => {
  const calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push([body.method, init.headers["mcp-session-id"]]);
    if (body.method === "initialize") return new Response("event: message\ndata: {}\n\n", { headers: { "mcp-session-id": "s1", "content-type": "text/event-stream" } });
    if (body.method === "tools/call") {
      const result = { result: { content: [{ type: "text", text: JSON.stringify(catalog) }] } };
      return new Response(`event: message\ndata: ${JSON.stringify(result)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    return new Response(null, { status: 202 });
  });
  expect(await new Store(seller).catalog()).toEqual(catalog);
  expect(calls).toEqual([["initialize", undefined], ["notifications/initialized", "s1"], ["tools/call", "s1"]]);
});

test("serves the registry itself at /marketplace.json", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ sellers: [seller] })));
  const response = await worker.fetch(new Request("https://yourlore.dev/marketplace.json"), {});
  expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
  expect((await response.json()).sellers[0].name).toBe("Dipak");
});

test("serves the live counts the page follows at /marketplace/stats.json", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ ...list([{ ...seller, listings: [] }]) })));
  const response = await worker.fetch(new Request("https://yourlore.dev/marketplace/stats.json"), {});
  expect(await response.json()).toEqual({ markets: 0, pieces: 0, sellers: 1 });
});
