// yourlore.dev/marketplace: the markets buyers browse, each filled with the pieces sellers
// listed in it, drawn as plain pages people and browsing agents can read without a script.
// The registry stays in the lore-marketplace repo and each piece's words come from its
// own store; this only draws them. /bids and /b/:id are the bid book (src/bid-routes.js).
// / is the home page, drawn around the live bids (src/home.js); /download starts the app's download and says how to open it (src/download.js).
import { frontDoor } from "./agents.js";
import { BidDesk, isBidPath } from "./bid-routes.js";
import { countDemand } from "./demand.js";
import { downloadPage } from "./download.js";
import { clip, date, escape, money, page, plural } from "./layout.js";
import { Exchange, sellersOf } from "./markets.js";

export { BidRail } from "./bid-rail.js";
export { BidBook } from "./bids.js";

const LIST = "https://raw.githubusercontent.com/dipakkrishnan/lore-marketplace/main/marketplace.json";
const HOME = "https://yourlore.dev/marketplace";
const ROWS_SHOWN = 3;
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const sentence = (text) => (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);
const searchable = (m) => [m.name, m.tab, ...m.rows.flatMap((r) => [r.question, r.sample, r.usefulIf, r.seller.name])].join(" ").toLowerCase();

const SEARCH_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

const offer = (row) => ({
  "@type": "Product",
  name: row.question,
  url: row.url,
  ...(row.sample ? { description: row.sample } : {}),
  offers: { "@type": "Offer", price: row.price, priceCurrency: "USD", url: row.url, seller: { "@type": "Person", name: row.seller.name, url: row.seller.store } }
});

const row = (r) =>
  `<li class="row"><a href="${escape(r.url)}"><span><span class="q">${escape(r.question)}</span><span class="who">${escape(r.seller.name)}${r.seller.test ? " · test store" : ""}</span></span><span class="pill">${money(r.price)}</span></a></li>`;

function card(m) {
  const people = sellersOf(m);
  return `<li class="card" data-search="${escape(searchable(m))}"><h3><span class="glyph" aria-hidden="true">${escape(m.name[0])}</span><a href="/marketplace/${m.id}">${escape(m.name)}</a></h3>
<ul class="rows">${m.rows.slice(0, ROWS_SHOWN).map(row).join("")}</ul>
<div class="foot-row"><span>${plural(m.rows.length, "piece")} · ${plural(people.length, "seller")}</span><a href="/marketplace/${m.id}">Open market →</a></div></li>`;
}

/** The latest events as list items, and a key that changes only when they do, so the strip redraws on real news. */
function latest(exchange) {
  const events = exchange.recent(5);
  const item = (e) =>
    e.row
      ? `<li data-k="${escape(`${e.day}:${e.row.id}`)}"><a href="${escape(e.row.url)}"><time>${date(e.day)}</time>Updated in ${escape(e.market.name)}: ${escape(clip(e.row.question, 48))}</a></li>`
      : `<li data-k="${escape(`${e.day}:${e.seller.name}`)}"><a href="${escape(e.seller.store)}"><time>${date(e.day)}</time>${escape(e.seller.name)} opened a store</a></li>`;
  return { html: events.map(item).join(""), key: events.map((e) => `${e.day}:${e.row ? e.row.id : e.seller.name}`).join("|") };
}

function tape(exchange) {
  const { html, key } = latest(exchange);
  if (!html) return "";
  return `<div class="tape"><span>Latest</span><ul data-live="latest" data-key="${escape(key)}">${html}</ul></div>`;
}

function stores(exchange) {
  if (!exchange.sellers.length) return "";
  const store = (s) =>
    `<li><a href="${escape(s.store)}"><b>${escape(s.name)}</b><span>${[...(s.test ? ["test store"] : []), plural(s.publications, "piece"), plural(s.markets?.size ?? 0, "market"), `${money(s.price_usd)} each`].join(" · ")}</span><em>Visit store →</em></a></li>`;
  return `<h2 class="part">Stores</h2><ul class="stores">${exchange.sellers.map(store).join("")}</ul>`;
}

/** The markets, by tab, optionally narrowed by a search and a seller. */
export function marketplacePage(exchange, { tab = "", q = "", seller = "" } = {}) {
  const tabs = exchange?.tabs ?? [];
  const current = tabs.find((t) => slug(t) === tab) ?? "";
  const who = exchange?.sellers.find((s) => slug(s.name) === seller);
  const query = q.trim().toLowerCase();
  const shown = (exchange?.markets ?? []).filter(
    (m) => (!current || m.tab === current) && (!who || m.rows.some((r) => r.seller === who)) && (!query || searchable(m).includes(query))
  );
  const link = (t) => {
    const params = new URLSearchParams({ ...(t ? { tab: slug(t) } : {}), ...(who ? { seller: slug(who.name) } : {}) });
    return `/marketplace${params.size ? `?${params}` : ""}`;
  };
  const sellerPick = exchange?.sellers.length
    ? `<form method="get" action="/marketplace">${current ? `<input type="hidden" name="tab" value="${escape(slug(current))}">` : ""}<select name="seller" aria-label="Seller"><option value="">All sellers</option>${exchange.sellers.map((s) => `<option value="${escape(slug(s.name))}"${s === who ? " selected" : ""}>${escape(s.name)}</option>`).join("")}</select> <button type="submit">Go</button></form>`
    : "";
  const sections = (current ? [current] : tabs)
    .map((t) => [t, shown.filter((m) => m.tab === t)])
    .filter(([, list]) => list.length)
    .map(([t, list]) => `<section class="tab"><h2>${escape(t)}</h2><ul class="grid">${list.map(card).join("")}</ul></section>`)
    .join("");
  const body = !exchange
    ? `<p class="empty">The markets can't be loaded right now. Try again in a minute.</p>`
    : !exchange.markets.length
      ? `<p class="empty">No market has a listing yet.</p>`
      : `${sections}<p class="empty none"${shown.length ? " hidden" : ""}>Nothing here matches that yet.</p>`;
  const count = (key, n, one) => `<li><b data-stat="${key}" aria-label="${n}">${n}</b>${n === 1 ? one : `${one}s`}</li>`;
  const head = `<header class="head"><div><h1>Markets</h1>
${exchange ? `<ul class="stats">${count("markets", exchange.markets.length, "market")}${count("pieces", exchange.pieces, "piece")}${count("sellers", exchange.sellers.length, "seller")}</ul>` : ""}</div>
<form class="search" method="get" action="/marketplace" role="search">${SEARCH_ICON}${current ? `<input type="hidden" name="tab" value="${escape(slug(current))}">` : ""}<input type="search" name="q" value="${escape(q)}" placeholder="Search questions, markets, sellers" aria-label="Search the markets"></form></header>
<div class="tabs"><ul>${["", ...tabs].map((t) => `<li><a href="${link(t)}"${t === current ? ' class="on" aria-current="page"' : ""}>${escape(t || "All")}</a></li>`).join("")}</ul>${sellerPick}</div>`;
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
    body: `${head}${exchange ? tape(exchange) : ""}${body}${exchange ? stores(exchange) : ""}`,
    data
  });
}

/** One market: every piece listed in it, with its free sample and a way to buy. */
export function marketPage(exchange, id) {
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
  const item = (r) =>
    `<li class="offer"><div><h2><a href="${escape(r.url)}">${escape(r.question)}</a></h2>${r.sample ? `<blockquote>${escape(r.sample)}</blockquote>` : ""}${r.usefulIf ? `<p class="fit">Useful if ${escape(sentence(r.usefulIf))}</p>` : ""}<p class="by">From <a href="${escape(r.seller.store)}">${escape(r.seller.name)}</a>${r.seller.test ? " · test store" : ""}${r.updated ? ` · updated ${date(r.updated)}` : ""}</p></div>
<div class="buy"><a class="go" href="${escape(r.url)}">View &amp; buy · ${money(r.price)} →</a></div></li>`;
  const nearby = exchange.markets.filter((other) => other.tab === m.tab && other !== m);
  return page({
    title: `${m.name} · Lore markets`,
    description: `${plural(m.rows.length, "firsthand piece")} on ${m.name.toLowerCase()}, from ${plural(people.length, "seller")}. Samples are free.`,
    canonical: `${HOME}/${m.id}`,
    section: "markets",
    alternate: `${HOME}/${m.id}.json`,
    body: `<p class="crumb"><a href="/marketplace">Markets</a> / <a href="/marketplace?tab=${slug(m.tab)}">${escape(m.tab)}</a></p><h1>${escape(m.name)}</h1>
<ul class="stats"><li><b>${m.rows.length}</b>${m.rows.length === 1 ? "piece" : "pieces"}</li><li><b>${people.length}</b>${people.length === 1 ? "seller" : "sellers"}</li><li><b>${money(Math.min(...m.rows.map((r) => r.price)))}</b>lowest price</li></ul>
<ul class="offers">${m.rows.map(item).join("")}</ul>${nearby.length ? `<h2 class="part">More in ${escape(m.tab)}</h2><ul class="related">${nearby.map((o) => `<li><a href="/marketplace/${o.id}">${escape(o.name)} · ${o.rows.length}</a></li>`).join("")}</ul>` : ""}`,
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
      const body = downloadPage({ ua: request.headers.get("user-agent") ?? "", bid: url.searchParams.get("bid") });
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
      const { html, key } = latest(exchange);
      return Response.json({ markets: exchange.markets.length, pieces: exchange.pieces, sellers: exchange.sellers.length, latest: html, latest_key: key }, { headers: { "cache-control": "public, max-age=30" } });
    }
    if (id) return html(marketPage(exchange, id), exchange.market(id) ? 200 : 404);
    const params = url.searchParams;
    return html(marketplacePage(exchange, { tab: params.get("tab") ?? "", q: params.get("q") ?? "", seller: params.get("seller") ?? "" }));
  }
};

export default worker;
