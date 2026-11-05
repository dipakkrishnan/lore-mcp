import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HERO, homePage } from "../src/home.js";
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
    expect(html).toContain('<div class="r"><i class="st sale"></i><span class="t">Pricing a sync placement by its reach</span><span title="Grok Bot"><img class="mk" src="/marks/grok.svg" alt="" width="16" height="16"></span><span class="w">On sale</span><time>Oct 30</time><span class="p">$4</span></div>');
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

  test("follows one memory through all four steps, at prices a person would pay", () => {
    const walk = homePage({ now }).match(/<ol class="walk">([\s\S]*?)<\/ol>/)[1];
    const steps = walk.split("<li>").slice(1);
    for (const step of steps.slice(1, 3)) expect(step).toContain("How our app hit #1 in its first week");
    expect(steps[3]).toContain("go viral in its first week");
    expect(walk).toContain('<span class="price">$8</span>');
    expect([...walk.matchAll(/<span class="p">\$(\d+)<\/span>/g)].map((m) => Number(m[1]))).toEqual([8, 6, 5]);
  });

  test("ends on the walkthrough: no beats and no bid list on the page itself", () => {
    const html = homePage({ bids: [bid("a", 5)], now });
    expect(html).not.toContain('class="beats"');
    expect(html).not.toContain('id="bids-title"');
    expect(rows(html)).toEqual([]);
  });

  test("escapes what buyers wrote in the structured data", () => {
    const html = homePage({ bids: [bid("a", 5, { question: `</script><script>alert("x")</script>` })], now });
    expect(html).not.toContain('<script>alert("x")');
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

  test("/ describes the live bids from the book to agents", async () => {
    const empty = await call("/");
    expect(empty.status).toBe(200);
    const listed = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1])["@graph"][1].itemListElement.map((i) => i.url);
    expect(listed(await empty.text())).toEqual([]);
    const placed = await call("/bids", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: "How do you stop reward hacking on long coding tasks?", usd: 120, market: "rl-evals" }) });
    const { id } = await placed.json();
    expect(listed(await (await call("/")).text())).toEqual([`https://yourlore.dev/b/${id}`]);
  });

  test("/download hands out the latest release, and unknown paths get the site's not-found page", async () => {
    expect((await call("/download")).headers.get("location")).toBe("https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip");
    const missing = await call("/no-such-page");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("<h1>Not found</h1>");
  });
});
