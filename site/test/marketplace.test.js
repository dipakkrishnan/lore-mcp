import { afterEach, expect, test, vi } from "vitest";
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
  expect(html).toMatch(/<span class="pill">\$1<\/span>/);
  expect(html).toMatch(/2 pieces · 1 seller/);
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

test("a tab, a search and a seller each narrow the markets, and work without a script", async () => {
  const markets = [
    { id: "learning-to-dive", name: "Learning to scuba dive", tab: "Travel" },
    { id: "soccer-tactics", name: "Soccer tactics", tab: "Sports" }
  ];
  const shane = { ...seller, name: "Shane", node: "https://shane.example.workers.dev/mcp", store: "https://shane.example.workers.dev/", listings: [{ market: "soccer-tactics", piece: C }] };
  const exchange = await load(list([{ ...seller, listings: [{ market: "learning-to-dive", piece: A }] }, shane], markets), async (s) =>
    s.name === "Shane" ? { topics: { soccer: [{ id: C, teaser: "How should wingers play?", updated_at: "2026-08-10" }] } } : catalog
  );
  const cards = (html) => (html.match(/<li class="card"/g) ?? []).length;
  expect(cards(marketplacePage(exchange))).toBe(2);
  expect(cards(marketplacePage(exchange, { tab: "sports" }))).toBe(1);
  expect(cards(marketplacePage(exchange, { q: "wingers" }))).toBe(1);
  expect(cards(marketplacePage(exchange, { seller: "shane" }))).toBe(1);
  expect(marketplacePage(exchange, { q: "nothing like this" })).toMatch(/<p class="empty none">Nothing here matches/);
  expect(marketplacePage(exchange, { tab: "sports" })).toMatch(/href="\/marketplace\?tab=sports" class="on"/);
});

test("a market's page shows each piece's free sample and a way to buy it", async () => {
  const exchange = await load(list([{ ...seller, listings: [{ market: "learning-to-dive", piece: A }] }]));
  const html = marketPage(exchange, "learning-to-dive");
  expect(html).toMatch(/<blockquote>Bonaire gave me a foundation\.<\/blockquote>/);
  expect(html).toMatch(/Useful if you&#39;re planning a first trip\./);
  expect(html).toMatch(/>View &amp; buy · \$1 →</);
  expect(marketPage(exchange, "nowhere")).toMatch(/No market by that name has a listing/);
});

test("the latest strip carries only real dates, labelled for what they are", async () => {
  const exchange = await load(list([{ ...seller, listings: [{ market: "learning-to-dive", piece: A }] }]));
  const html = marketplacePage(exchange);
  expect(html).toMatch(/<time>Oct 22<\/time>Updated in Learning to scuba dive/);
  expect(html).toMatch(/<time>Sep 15<\/time>Dipak opened a store/);
  expect(html).toMatch(/<ul data-live="latest" data-key="2026-10-22:aaaaaaaaaaaaaaaaaaaaaaaa\|2026-09-15:Dipak">/);
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
  const { latest, latest_key, ...counts } = await response.json();
  expect(counts).toEqual({ markets: 0, pieces: 0, sellers: 1 });
  // The strip follows the same reply, redrawn only when its key moves.
  expect(latest_key).toBe("2026-09-15:Dipak");
  expect(latest).toMatch(/<time>Sep 15<\/time>Dipak opened a store/);
});
