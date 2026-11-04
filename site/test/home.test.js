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
  const text = (html) => html.replace(/<style>[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<[^>]+>/g, " ").replace(/\s+/g, " ");

  test("leads with the live hero, one download, and a trust line that names only true things", () => {
    const html = homePage({ now });
    expect(HERO.title).toBe("Private memory you can sell to agents.");
    expect(html).toContain(`<section class="hero"><h1>${HERO.title}</h1>`);
    expect(html).toContain("Free · Open source · Nothing you&#39;ve taught it is shared until you approve it");
    expect(html).not.toContain("Notarized");
    expect(html.match(/href="\/download"/g)).toHaveLength(2);
    expect(html).toContain('<nav><a href="/bids">Bids</a><a href="/marketplace">Markets</a><a href="https://github.com/dipakkrishnan/lore-mcp">GitHub</a><a href="/download">Download</a></nav>');
    expect(html).toContain('<a href="/llms.txt">For agents</a>');
  });

  test("names the apps it gathers from, each with its own mark", () => {
    const html = homePage({ now });
    expect(text(html)).toContain("Gathers from Grok Bot Claude ChatGPT Obsidian Notion Granola Substack Readwise and more");
    for (const id of ["grok", "claude", "chatgpt", "obsidian", "notion", "granola", "substack", "readwise"]) expect(html).toContain(`src="/marks/${id}.svg"`);
  });

  test("draws the app as it is now: Inbox, Inventory, Bids and Connectors, with Inventory as one-line rows", () => {
    const html = homePage({ now });
    const side = html.match(/<aside class="side">([\s\S]*?)<\/aside>/)[1];
    expect([...side.matchAll(/<\/svg>(\w+)<em>/g)].map((m) => m[1])).toEqual(["Inbox", "Inventory", "Bids", "Connectors"]);
    expect(html).not.toMatch(/>Today<|Good evening/);
    expect(html).toContain('<div class="r"><i class="st sale"></i><span class="t">Pricing a sync placement by its reach</span><span title="Grok Bot"><img class="mk" src="/marks/grok.svg" alt="" width="16" height="16"></span><span class="w">On sale</span><time>Oct 30</time><span class="p">$5</span></div>');
    expect(html).toContain('<figcaption class="cap">Illustrative</figcaption>');
  });

  test("walks through the product in four short steps, each with its screen, after the app window", () => {
    const html = homePage({ now });
    const walk = html.match(/<ol class="walk">([\s\S]*?)<\/ol>/)[1];
    expect([...walk.matchAll(/<p><b>(.*?)<\/b>/g)].map((m) => m[1])).toEqual(["Connect your agents and apps.", "Lore turns them into private memories.", "Pick what's worth selling.", "Get paid."]);
    expect(walk.match(/<figure class="shot /g)).toHaveLength(4);
    expect(walk).toContain('<a href="/bids">post a bid</a>');
    expect(html.indexOf('class="shot app"')).toBeLessThan(html.indexOf('id="how-title"'));
    expect(html).toContain("Screens are illustrative");
  });

  test("speaks to people, with no protocol names or API docs", () => {
    const words = text(homePage({ now }));
    expect(words).not.toMatch(/\bMCP\b|mainnet|x402|USDC|stablecoin|Worker|JSON|endpoint|\bpieces?\b/i);
    expect(words).not.toMatch(/\bPOST\b/);
  });

  test("names no one: the page is about the reader, not the maker", () => {
    expect(homePage({ bids: [bid("a", 5)], now })).not.toMatch(/Dipak|dipakrkrishnan|Bonaire/);
  });

  test("draws no bids at all when none are open and nothing is featured: nothing fake stands in", () => {
    expect(FEATURED).toEqual([]);
    const html = homePage({ now });
    expect(rows(html)).toEqual([]);
    expect(html).toContain("No open bids right now.");
    expect(html).toContain('<a class="quiet" href="/bids?ask#ask">Place a bid</a>');
  });

  test("lists the open bids below the walkthrough, not in the hero: biggest first, at most five, with All bids", () => {
    const html = homePage({ bids: [bid("a", 5), bid("b", 300), bid("c", 40), bid("d", 60), bid("e", 15), bid("f", 25)], now });
    expect(html.indexOf('id="bids-title"')).toBeGreaterThan(html.indexOf('id="how-title"'));
    expect(html.match(/<section class="hero">[\s\S]*?<\/section>/)[0]).not.toContain("/b/");
    expect(rows(html)).toEqual(["b", "d", "c", "f", "e"]);
    expect(html).toContain('<h2 id="bids-title">Open bids<a href="/bids">All bids →</a></h2>');
    expect(html).toContain('<li data-bid="b" data-usd="300"><a class="line mini" href="/b/b"><span class="amt">$300</span><span class="q">Question b worth asking?</span><span class="side">7 days left</span></a></li>');
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

  test("describes the app and the open bids as structured data", () => {
    const html = homePage({ bids: [bid("a", 5)], now });
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
    expect(data["@graph"][0]).toMatchObject({ "@type": "SoftwareApplication", name: "Lore", downloadUrl: "https://yourlore.dev/download" });
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
    expect(rows(await empty.text())).toEqual([]);
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
