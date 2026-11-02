// The front door for agents: plain text and JSON at fixed addresses, drawn from the same
// Exchange the marketplace pages render, so what an agent reads can't drift from what a person sees.
import { countDemand } from "./demand.js";

const SITE = "https://yourlore.dev";
const BUYER_SKILL = "https://github.com/dipakkrishnan/lore-mcp/tree/main/plugins/lore/skills/lore-buy";
const TEXT = { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" };
const OPEN = { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" };

const xml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

/** What Lore sells and how an agent searches, reads, buys and bids; the bid lines appear only once bids are served. */
export function llmsTxt({ bids = false } = {}) {
  return [
    "# Lore",
    "",
    "> Lore sells first-hand know-how: how someone decided something, and the methods that worked for them, written up and approved by that person. Each payment goes straight to the seller; Lore never holds money.",
    "",
    "Lore never sells facts about a person, raw chats or notes, or anything its seller hasn't approved.",
    "",
    `- Search: ${SITE}/marketplace.jsonl has one JSON object per listed piece${bids ? " and open bid" : ""} (market, seller, title, price_usd, useful_if, not_useful_if, sample, url, node, updated). Download it once and filter in code.`,
    `- Browse: ${SITE}/marketplace lists the markets; each market page links its JSON at ${SITE}/marketplace/<market>.json.`,
    "- Read a free sample: each piece's `sample` is on its line and on its page (`url`). The seller's MCP server (`node`) answers `discover` for free with every piece's sample and fit.",
    "- Buy over MCP: call `get` with the piece's `id` on its `node`; the store asks for payment in USDC with x402 (`test: true` means Base Sepolia test money).",
    "- Buy by card: open the piece's `url` and pay there, where the store takes cards. `<url>.json` shows the price.",
    `- Buy within a budget, end to end: the lore-buy skill, ${BUYER_SKILL}`,
    ...(bids
      ? [`- Bid when nothing fits: POST ${SITE}/bids with question (10-280 characters), usd (whole dollars, 5-1000), market, and optionally email or callback_url, as JSON or a form. The same form is at ${SITE}/bids.`]
      : []),
    ""
  ].join("\n");
}

export function robotsTxt() {
  return ["User-agent: *", "Allow: /", "", `Sitemap: ${SITE}/sitemap.xml`, `# For agents: ${SITE}/llms.txt`, ""].join("\n");
}

/** Home, the markets, each market, and each listed piece (pieces live on their sellers' stores). */
export function sitemap(exchange) {
  const urls = [`${SITE}/`, `${SITE}/marketplace`, ...(exchange?.markets ?? []).flatMap((m) => [`${SITE}/marketplace/${m.id}`, ...m.rows.map((r) => r.url)])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((u) => `<url><loc>${xml(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

/** One listed row, as an agent reads it. A collection sells several pieces as one. */
export function pieceRecord(market, row) {
  return {
    type: row.collection ? "collection" : "piece",
    id: row.id,
    market: market.id,
    market_name: market.name,
    seller: row.seller.name,
    title: row.question,
    price_usd: row.price,
    ...(row.collection ? { pieces: row.pieces } : {}),
    useful_if: row.usefulIf,
    not_useful_if: row.notUsefulIf,
    sample: row.sample,
    url: row.url,
    json: `${row.url}.json`,
    node: row.seller.node,
    test: row.seller.test,
    updated: row.updated
  };
}

/** A bid's public shape (contracts/bids.md), narrowed to named fields so nothing private can ride along. */
export function bidRecord(bid) {
  const { id, url, question, usd, market, status, created, expires, answers } = bid;
  return { type: "bid", id, market, question, usd, status, url, json: `${url}.json`, created, expires, answers: Array.isArray(answers) ? answers.length : 0 };
}

/**
 * The open seam for bids: read through the contract's own `GET /bids.json`, so this needs nothing
 * from the bids module but its public route. Without the BIDS binding there are no bids to list.
 */
export async function openBids(env, self) {
  if (!env?.BIDS) return [];
  try {
    const response = await self("/bids.json");
    const { bids } = response.ok ? await response.json() : {};
    return Array.isArray(bids) ? bids.filter((b) => b?.status === "open" || b?.status === "answered") : [];
  } catch {
    return [];
  }
}

export function catalog(exchange, bids = []) {
  const records = [...exchange.markets.flatMap((m) => m.rows.map((r) => pieceRecord(m, r))), ...bids.map(bidRecord)];
  return records.map((r) => `${JSON.stringify(r)}\n`).join("");
}

export function marketJson(exchange, id) {
  const m = exchange.market(id);
  return m && { id: m.id, name: m.name, tab: m.tab, url: `${SITE}/marketplace/${m.id}`, pieces: m.rows.map((r) => pieceRecord(m, r)) };
}

const unavailable = () => Response.json({ error: "the markets can't be loaded right now" }, { status: 502, headers: { "cache-control": "no-store" } });

/** The routes, by path, with the demand event each counts; each takes what it needs: the env, the exchange (null when it can't load), and a way to ask this Worker for a path. */
const ROUTES = [
  [/^\/llms\.txt$/, "agent.llms", async ({ env }) => new Response(llmsTxt({ bids: Boolean(env?.BIDS) }), { headers: TEXT })],
  [/^\/robots\.txt$/, null, async () => new Response(robotsTxt(), { headers: TEXT })],
  [/^\/sitemap\.xml$/, "agent.sitemap", async ({ exchange }) => new Response(sitemap(await exchange()), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=300" } })],
  [
    /^\/marketplace\.jsonl$/,
    "agent.catalog",
    async ({ env, exchange, self }) => {
      const [loaded, bids] = await Promise.all([exchange(), openBids(env, self)]);
      return loaded ? new Response(catalog(loaded, bids), { headers: { "content-type": "application/jsonl; charset=utf-8", ...OPEN } }) : unavailable();
    }
  ],
  [
    /^\/marketplace\/([a-z0-9-]+)\.json$/,
    "agent.json",
    async ({ exchange }, id) => {
      const loaded = await exchange();
      if (!loaded) return unavailable();
      const market = marketJson(loaded, id);
      return Response.json(market ?? { error: "no market by that name has a listing" }, { status: market ? 200 : 404, headers: OPEN });
    }
  ]
];

/** The handler for an agent path, or null when the path isn't one. Each request it serves is counted as agent demand. */
export function frontDoor(pathname) {
  for (const [pattern, event, serve] of ROUTES) {
    const match = pathname.match(pattern);
    if (match) {
      return (context) => {
        if (event) countDemand(event, context.request, context.env, context.ctx);
        return serve(context, ...match.slice(1));
      };
    }
  }
  return null;
}
