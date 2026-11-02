import { createExecutionContext, runInDurableObject, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FEATURED, HERO, homePage } from "../src/home.js";
import worker from "../src/worker.js";

const MARKETS = [{ id: "rl-evals", name: "RL evals", tab: "AI" }];
const now = Date.parse("2026-11-01T00:00:00Z");
const bid = (id, usd, extra = {}) => ({ id, usd, market: "rl-evals", status: "open", question: `Question ${id} worth asking?`, created: "2026-10-31T22:10:00Z", expires: "2026-11-07T22:10:00Z", answers: [], ...extra });
const rows = (html) => [...html.matchAll(/<a class="line" href="\/b\/(\w+)">/g)].map((m) => m[1]);
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
    expect(html).toContain("Free · Open source · Notarized by Apple · Nothing you&#39;ve taught it is shared until you approve it");
    expect(html.match(/href="\/download"/g)).toHaveLength(3);
    expect(html).toContain('<nav><a href="/bids">Bids</a><a href="/marketplace">Markets</a><a href="https://github.com/dipakkrishnan/lore-mcp">Open source</a><a href="/download">Download</a></nav>');
    expect(html).toContain('<a href="/llms.txt">For agents</a>');
  });

  test("speaks to people, with no protocol names or API docs", () => {
    const text = homePage({ now }).replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>|<[^>]+>/g, " ");
    expect(text).not.toMatch(/\bMCP\b|mainnet|x402|USDC|Worker|POST|JSON|endpoint|\bpieces?\b/i);
  });

  test("draws no bids at all when none are open and nothing is featured: nothing fake stands in", () => {
    expect(FEATURED).toEqual([]);
    const html = homePage({ now });
    expect(html).not.toContain('id="bids-title"');
    expect(rows(html)).toEqual([]);
  });

  test("shows the open bids as rows, biggest first, at most five", () => {
    const html = homePage({ bids: [bid("a", 5), bid("b", 300), bid("c", 40), bid("d", 60), bid("e", 15), bid("f", 25)], markets: MARKETS, now });
    expect(html).toContain("Open bids");
    expect(rows(html)).toEqual(["b", "d", "c", "f", "e"]);
    expect(html).toContain('<span class="amt">$300</span><span class="q">Question b worth asking?</span><span class="side"><span class="mk">RL evals</span><span>7 days left</span><span>0 answers</span></span>');
  });

  test("falls back to the owner's featured bids, labelled as recent, only when none are open", () => {
    const featured = [bid("z", 80, { status: "filled" })];
    expect(rows(homePage({ featured, now }))).toEqual(["z"]);
    expect(homePage({ featured, now })).toContain("Recent bids");
    expect(rows(homePage({ bids: [bid("a", 5)], featured, now }))).toEqual(["a"]);
  });

  test("escapes what buyers wrote", () => {
    const html = homePage({ bids: [bid("a", 5, { question: `<script>alert("x")</script> & more` })], markets: MARKETS, now });
    expect(html).not.toContain('<script>alert("x")');
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; more");
  });

  test("labels every illustrative step of the worked example, and links the real one", () => {
    const html = homePage({ now });
    expect(html).toContain("The question<small>Illustrative</small>");
    expect(html).toContain("What Lore kept<small>Private, on Dipak's Mac. Shown in outline</small>");
    expect(html).toContain("What Dipak approved<small>Real. The free first lines of his answer</small>");
    expect(html.match(/<small>Illustrative<\/small>/g)).toHaveLength(3);
    expect(html).toContain('href="https://lore.dipakrkrishnan.workers.dev/p/fff411212f0157275f3fbb59"');
    expect(html).toContain("The bids beside each are examples.");
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
    expect(html).toContain('<span class="mk">RL evals</span>');
  });

  test("/download hands out the latest release, and unknown paths get the site's not-found page", async () => {
    expect((await call("/download")).headers.get("location")).toBe("https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip");
    const missing = await call("/no-such-page");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("<h1>Not found</h1>");
  });
});
