import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FEATURED, HERO, homePage } from "../src/home.js";
import worker from "../src/worker.js";

const MARKETS = [{ id: "rl-evals", name: "RL evals", tab: "AI" }];
const now = Date.parse("2026-11-01T00:00:00Z");
const bid = (id, usd, extra = {}) => ({ id, usd, market: "rl-evals", status: "open", question: `Question ${id} worth asking?`, created: "2026-10-30T22:10:00Z", expires: "2026-11-07T22:10:00Z", answers: [], ...extra });
const rows = (html) => [...html.matchAll(/<a class="line[^"]*" href="\/b\/(\w+)">/g)].map((m) => m[1]);
const pass = () => ({ limit: async () => ({ success: true }) });

async function call(path, init = {}) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(`https://yourlore.dev${path}`, { redirect: "manual", ...init }), { ...env, BID_RATE_LIMIT: pass(), BID_GLOBAL_RATE_LIMIT: pass() }, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

describe("the home page", () => {
  test("leads with what Lore does for you, one download, and a trust line that names only true things", () => {
    const html = homePage({ now });
    expect(html).toContain(`<h1>${HERO.title}</h1>`);
    expect(html).toContain("Free · Open source");
    expect(html.match(/href="\/download"/g)).toHaveLength(2);
    expect(html).toContain('<nav><a href="/bids">Bids</a><a href="/marketplace">Markets</a><a href="https://github.com/dipakkrishnan/lore-mcp">GitHub</a><a href="/download">Download</a></nav>');
    expect(html).toContain('<a href="/llms.txt">For agents</a>');
  });

  test("speaks to people, with the agent addresses kept to their own section", () => {
    const text = homePage({ now }).replace(/<section class="agents" id="agents"[\s\S]*?<\/section>|<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, " ");
    expect(text).not.toMatch(/\bMCP\b|mainnet|x402|USDC|Worker|JSON|endpoint|\bpieces?\b/i);
    expect(text).not.toMatch(/\bPOST\b/);
  });

  test("draws no bids at all when none are open and nothing is featured: nothing fake stands in", () => {
    expect(FEATURED).toEqual([]);
    const html = homePage({ now });
    expect(html).not.toContain('id="bids-title"');
    expect(rows(html)).toEqual([]);
    expect(html).toContain("No open bids right now.");
    expect(html).toContain('<a class="quiet ask" href="/bids?ask#ask">Place a bid</a>');
  });

  test("puts the open bids beside the hero, biggest first, at most four, with a way to ask", () => {
    const html = homePage({ bids: [bid("a", 5), bid("b", 300), bid("c", 40), bid("d", 60), bid("e", 15), bid("f", 25)], now });
    expect(html.indexOf('id="bids-title"')).toBeLessThan(html.indexOf('id="agents-title"'));
    expect(html).toMatch(/<\/h1>[\s\S]*<aside class="demand" aria-labelledby="bids-title">[\s\S]*<\/section>/);
    expect(rows(html)).toEqual(["b", "d", "c", "f"]);
    expect(html).toContain('<a class="line mini" href="/b/b"><span class="amt">$300</span><span class="q">Question b worth asking?</span><span class="side">7 days left</span></a>');
    expect(html).toContain("You&#39;re charged only if someone answers it.");
  });

  test("an empty answer count says nothing; a day-old bid says New; answers are counted", () => {
    const fresh = { ...bid("n", 9), created: "2026-10-31T23:00:00Z" };
    const answeredBid = { ...bid("m", 9), answers: [{}, {}] };
    const html = homePage({ bids: [fresh, answeredBid, bid("o", 9)], now });
    expect(html).toContain('href="/b/n"><span class="amt">$9</span><span class="q">Question n worth asking?</span><span class="side">7 days left · New</span>');
    expect(html).toContain('<span class="side">7 days left · 2 answers</span>');
    expect(html).toContain('href="/b/o"><span class="amt">$9</span><span class="q">Question o worth asking?</span><span class="side">7 days left</span>');
    expect(html).not.toContain("0 answers");
  });

  test("says when a bid has no card behind it, so its amount isn't read as money waiting", () => {
    const html = homePage({ bids: [bid("p", 9, { card: true }), bid("u", 8, { card: false })], now });
    expect(html).toContain('href="/b/p"><span class="amt">$9</span><span class="q">Question p worth asking?</span><span class="side">7 days left</span>');
    expect(html).toContain('href="/b/u"><span class="amt">$8</span><span class="q">Question u worth asking?</span><span class="side">7 days left · No card on file</span>');
  });

  test("falls back to the owner's featured bids, labelled as recent, only when none are open", () => {
    const featured = [bid("z", 80, { status: "filled" })];
    expect(rows(homePage({ featured, now }))).toEqual(["z"]);
    expect(homePage({ featured, now })).toContain("Recent bids");
    expect(rows(homePage({ bids: [bid("a", 5)], featured, now }))).toEqual(["a"]);
  });

  test("escapes what buyers wrote", () => {
    const html = homePage({ bids: [bid("a", 5, { question: `<script>alert("x")</script> & more` })], now });
    expect(html).not.toContain('<script>alert("x")');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more");
  });

  test("stays short: what Lore is, the bids, one download and a note for agents", () => {
    const text = homePage({ now }).replace(/<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, " ");
    expect(text.split(/\s+/).filter(Boolean).length).toBeLessThan(200);
    expect(homePage({ now }).match(/<h2/g)).toHaveLength(2);
  });

  test("names no one: the page is about the reader, not the maker", () => {
    expect(homePage({ now })).not.toMatch(/Dipak|dipakrkrishnan|Bonaire/);
  });

  test("tells a browser agent where to read bids, place one without a card, and search, and says it as structured data", () => {
    const html = homePage({ bids: [bid("a", 5)], now });
    expect(html).toContain('<h2 id="agents-title">For agents</h2>');
    for (const href of ["/bids.json", "/bids", "/marketplace.jsonl", "/llms.txt"]) expect(html).toContain(`<a href="${href}">${href}</a>`);
    expect(html).toContain("an agent can bid without a card");
    expect(html).toContain('<li data-bid="a" data-usd="5">');
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    expect(data["@graph"][1].itemListElement).toEqual([{ "@type": "ListItem", position: 1, url: "https://yourlore.dev/b/a", name: "Question a worth asking?" }]);
  });
});

describe("served by the Worker", () => {
  beforeEach(async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => (String(url).includes("lore-marketplace") ? Response.json({ markets: MARKETS, sellers: [] }) : new Response(null, { status: 404 })));
    const book = env.BIDS.get(env.BIDS.idFromName("book"));
    await runInDurableObject(book, (_instance, state) => state.storage.sql.exec("DELETE FROM bid_events; DELETE FROM bids; DELETE FROM meta"));
  });
  afterEach(() => vi.restoreAllMocks());

  test("/ draws the live bids from the book", async () => {
    const empty = await call("/");
    expect(empty.status).toBe(200);
    expect(await empty.text()).not.toContain('id="bids-title"');
    const placed = await call("/bids", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "How do you stop reward hacking on long coding tasks?", usd: 120, market: "rl-evals" }) });
    const { id } = await placed.json();
    const html = await (await call("/")).text();
    expect(rows(html)).toEqual([id]);
    expect(html).toContain("7 days left · New · No card on file</span>");
  });

  test("/download hands out the latest release, and unknown paths get the site's not-found page", async () => {
    expect((await call("/download")).headers.get("location")).toBe("https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip");
    const missing = await call("/no-such-page");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("<h1>Not found</h1>");
  });
});
