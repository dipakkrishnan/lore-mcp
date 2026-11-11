// yourlore.dev/marketplace: the markets buyers browse, each filled with the pieces sellers
// listed in it, drawn as plain pages people and browsing agents can read without a script.
// The registry stays in the lore-marketplace repo and each piece's words come from its
// own store; this only draws them. /bids and /b/:id are the bid book (src/bid-routes.js).
// / is the home page, drawn around the live bids (src/home.js); /download starts the app's download and says how to open it (src/download.js).
import { frontDoor } from "./agents.js";
import { BidDesk, isBidPath } from "./bid-routes.js";
import { countDemand } from "./demand.js";
import { downloadPage } from "./download.js";
import { date, escape, money, page, plural } from "./layout.js";
import { Exchange, sellersOf } from "./markets.js";

export { BidRail } from "./bid-rail.js";
export { BidBook } from "./bids.js";

const LIST = "https://raw.githubusercontent.com/dipakkrishnan/lore-marketplace/main/marketplace.json";
const HOME = "https://yourlore.dev/marketplace";
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const searchable = (m, r) => [m.name, m.tab, r.question, r.sample, r.usefulIf, r.seller.name].join(" ").toLowerCase();

const SEARCH_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const offer = (row) => ({
  "@type": "Product",
  name: row.question,
  url: row.url,
  ...(row.sample ? { description: row.sample } : {}),
  offers: { "@type": "Offer", price: row.price, priceCurrency: "USD", url: row.url, seller: { "@type": "Person", name: row.seller.name, url: row.seller.store } }
});

/** Every piece in these markets, one row per market it's listed in, the most recently updated first. */
const entries = (markets) =>
  markets.flatMap((m) => m.rows.map((r) => ({ m, r }))).sort((a, b) => b.r.updated.localeCompare(a.r.updated) || a.r.question.localeCompare(b.r.question));

/** One piece as a row, drawn like a bid on /bids: price · question · market, seller, updated. The row opens the piece on its store. */
const line = ({ m, r }) =>
  `<li data-k="${escape(`${m.id}:${r.id}`)}" data-search="${escape(searchable(m, r))}"><a class="line" href="${escape(r.url)}"><span class="amt">${money(r.price)}</span><span class="q">${escape(r.question)}</span><span class="side"><span class="mk">${escape(m.name)}</span><span>${escape(r.seller.name)}${r.seller.test ? " · test store" : ""}</span>${r.updated ? `<span>Updated ${date(r.updated)}</span>` : ""}</span></a></li>`;

/** The markets as text tabs, as on /bids: All, then each market with a listing, the fullest first. */
function tabs(exchange, current) {
  const tab = (href, name, n, on) => `<li><a href="${href}"${on ? ' class="on" aria-current="page"' : ""}>${escape(name)}<small>${n}</small></a></li>`;
  const fullest = [...exchange.markets].sort((a, b) => b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  return `<nav class="tabs" aria-label="Markets"><ul>${tab("/marketplace", "All", exchange.pieces, !current)}${fullest.map((m) => tab(`/marketplace/${m.id}`, m.name, m.rows.length, m === current)).join("")}</ul></nav>`;
}

/** The tabs and the rows, narrowed to one market (or none), a seller and a search. Without a script the form searches on the server. */
function list(exchange, current, { q = "", seller = "" }) {
  const query = q.trim().toLowerCase();
  const who = exchange.sellers.find((s) => slug(s.name) === seller);
  const shown = entries(current ? [current] : exchange.markets).filter(({ m, r }) => (!who || r.seller === who) && (!query || searchable(m, r).includes(query)));
  return `${tabs(exchange, current)}<ul class="list">${shown.map(line).join("")}</ul><p class="empty none"${shown.length ? " hidden" : ""}>Nothing here matches that yet.</p>`;
}

function search(action, exchange, { q = "", seller = "" }) {
  const who = exchange?.sellers.find((s) => slug(s.name) === seller);
  return `<form class="search" method="get" action="${action}" role="search">${SEARCH_ICON}${who ? `<input type="hidden" name="seller" value="${escape(slug(who.name))}">` : ""}<input type="search" name="q" value="${escape(q)}" placeholder="Search questions, markets, sellers" aria-label="Search the markets"></form>`;
}

function stores(exchange) {
  if (!exchange.sellers.length) return "";
  const store = (s) =>
    `<li><a href="${escape(s.store)}"><b>${escape(s.name)}</b><span>${[...(s.test ? ["test store"] : []), plural(s.publications, "piece"), plural(s.markets?.size ?? 0, "market"), `${money(s.price_usd)} each`].join(" · ")}</span><em>Visit store →</em></a></li>`;
  return `<h2 class="part">Stores</h2><ul class="stores">${exchange.sellers.map(store).join("")}</ul>`;
}

/** Every market's pieces as one list of rows, narrowed by a search or a seller. */
export function marketplacePage(exchange, filters = {}) {
  const body = !exchange
    ? `<p class="empty">The markets can't be loaded right now. Try again in a minute.</p>`
    : !exchange.markets.length
      ? `<p class="empty">No market has a listing yet.</p>`
      : list(exchange, null, filters);
  const count = (key, n, one) => `<li><b data-stat="${key}" aria-label="${n}">${n}</b>${n === 1 ? one : `${one}s`}</li>`;
  const head = `<header class="head"><div><h1>Markets</h1>
${exchange ? `<ul class="stats">${count("markets", exchange.markets.length, "market")}${count("pieces", exchange.pieces, "piece")}${count("sellers", exchange.sellers.length, "seller")}</ul>` : ""}</div>
${search("/marketplace", exchange, filters)}</header>`;
  const data = exchange && {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Lore markets",
    url: HOME,
    numberOfItems: exchange.pieces,
    itemListElement: exchange.markets.flatMap((m) => m.rows.map((r) => ({ ...offer(r), category: m.name }))).map((item, i) => ({ "@type": "ListItem", position: i + 1, item }))
  };
  return page({
    title: "Lore markets",
    description: "Browse markets of firsthand experience. Read free samples; every payment goes straight to the person who lived it.",
    canonical: HOME,
    section: "markets",
    body: `${head}${body}${exchange ? stores(exchange) : ""}`,
    data
  });
}

/** One market: the same list of rows, narrowed to it, with its tab lit. */
export function marketPage(exchange, id, filters = {}) {
  const m = exchange?.market(id);
  if (!m) {
    return page({
      title: "Market not found · Lore",
      description: "This market isn't listed.",
      canonical: HOME,
      section: "markets",
      body: `<p class="crumb"><a href="/marketplace">Markets</a></p><h1>Not listed</h1><p class="lede">${exchange ? "No market by that name has a listing." : "The markets can't be loaded right now. Try again in a minute."}</p><p><a class="go" href="/marketplace">All markets →</a></p>`
    });
  }
  const people = sellersOf(m);
  // This market's own counts, fixed: the page's poll follows the whole exchange, so nothing here carries data-stat.
  const stat = (value, label) => `<li><b>${value}</b>${label}</li>`;
  return page({
    title: `${m.name} · Lore markets`,
    description: `${plural(m.rows.length, "firsthand piece")} on ${m.name.toLowerCase()}, from ${plural(people.length, "seller")}. Samples are free.`,
    canonical: `${HOME}/${m.id}`,
    section: "markets",
    alternate: `${HOME}/${m.id}.json`,
    body: `<header class="head"><div><p class="crumb"><a href="/marketplace">Markets</a></p><h1>${escape(m.name)}</h1>
<ul class="stats">${stat(m.rows.length, m.rows.length === 1 ? "piece" : "pieces")}${stat(people.length, people.length === 1 ? "seller" : "sellers")}${stat(money(Math.min(...m.rows.map((r) => r.price))), "lowest price")}</ul></div>
${search(`/marketplace/${m.id}`, exchange, filters)}</header>
${list(exchange, m, filters)}`,
    data: { "@context": "https://schema.org", "@type": "ItemList", name: m.name, url: `${HOME}/${m.id}`, numberOfItems: m.rows.length, itemListElement: m.rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, item: offer(r) })) }
  });
}

const html = (body, status = 200, cache = "public, max-age=60") =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });

/** The registry, parsed, or null when it can't be loaded. */
async function registry() {
  try {
    const response = await fetch(LIST, { cf: { cacheTtl: 300, cacheEverything: true } });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

const NOT_FOUND = page({
  title: "Not found · Lore",
  description: "Nothing lives at this address.",
  canonical: "https://yourlore.dev/",
  body: `<h1>Not found</h1><p class="lede">Nothing lives at this address.</p><p><a class="go" href="/">Go to Lore</a></p>`
});

/** A static file, or the site's own not-found page. */
async function asset(request, env) {
  const found = await env.ASSETS.fetch(request);
  return found.status === 404 ? html(NOT_FOUND, 404) : found;
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/") return new BidDesk(request, env, ctx, registry).home();
    if (url.pathname === "/download") {
      const body = downloadPage({ ua: request.headers.get("user-agent") ?? "", bid: url.searchParams.get("bid"), touch: url.searchParams.has("touch") });
      return new Response(body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store", vary: "user-agent" } });
    }
    if (isBidPath(url.pathname)) return new BidDesk(request, env, ctx, registry).respond();
    const json = url.pathname === "/marketplace.json";
    const stats = url.pathname === "/marketplace/stats.json";
    const door = !stats && frontDoor(url.pathname);
    if (door) return door({ request, env, ctx, exchange: () => Exchange.from(LIST), self: (path) => worker.fetch(new Request(new URL(path, url)), env, ctx) });
    const [, id] = url.pathname.match(/^\/marketplace\/([a-z0-9-]+)\/?$/) ?? [];
    if (!json && !id && !stats && url.pathname !== "/marketplace" && url.pathname !== "/marketplace/") return asset(request, env);
    if (json) countDemand("agent.json", request, env, ctx);
    let list;
    try {
      const response = await fetch(LIST, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (!response.ok) throw new Error(`marketplace list: ${response.status}`);
      if (json) {
        return new Response(response.body, {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" }
        });
      }
      list = await response.json();
    } catch {
      if (json || stats) return Response.json({ error: "the seller list can't be loaded right now" }, { status: 502, headers: { "cache-control": "no-store" } });
      // Rendered as "can't be loaded right now"; the page itself still answers.
      return html(id ? marketPage(null, id) : marketplacePage(null), 200, "no-store");
    }
    const exchange = await Exchange.load(list);
    if (stats) {
      return Response.json({ markets: exchange.markets.length, pieces: exchange.pieces, sellers: exchange.sellers.length }, { headers: { "cache-control": "public, max-age=30" } });
    }
    const filters = { q: url.searchParams.get("q") ?? "", seller: url.searchParams.get("seller") ?? "" };
    if (id) return html(marketPage(exchange, id, filters), exchange.market(id) ? 200 : 404);
    return html(marketplacePage(exchange, filters));
  }
};

export default worker;
