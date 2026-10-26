// yourlore.dev/marketplace: the markets buyers browse, each filled with the pieces sellers
// listed in it, drawn as plain pages people and browsing agents can read without a script.
// The registry stays in the lore-marketplace repo and each piece's words come from its
// own store; this only draws them. Every other path is the static site.
import { Exchange, sellersOf } from "./markets.js";

const LIST = "https://raw.githubusercontent.com/dipakkrishnan/lore-marketplace/main/marketplace.json";
const LIST_URL = "https://yourlore.dev/marketplace.json";
const HOME = "https://yourlore.dev/marketplace";
const BUYER_SKILL = "https://github.com/dipakkrishnan/lore-mcp/tree/main/plugins/lore/skills/lore-buy";
const DOWNLOAD = "https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip";
const ROWS_SHOWN = 3;
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (usd) => (usd < 0.01 ? `$${usd}` : Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);
const date = (iso) => {
  const parsed = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : day.format(parsed);
};
const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const sentence = (text) => (/^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text);
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const searchable = (m) => [m.name, m.tab, ...m.rows.flatMap((r) => [r.question, r.sample, r.usefulIf, r.seller.name])].join(" ").toLowerCase();

const MARK = `<svg class="mark" viewBox="0 0 26 26" aria-hidden="true"><rect x="4.5" y="5" width="17" height="16" rx="3.2" fill="currentColor"/><path d="M3 11.2L4.5 10.6C8 9.2 10.5 12.2 13 10.9S18.5 9.6 21.5 11.2L23 12M3 16.9L4.5 16.3C8 15 10.5 17.8 13 16.6S18.5 15 21.5 16.8L23 17.7" fill="none" stroke="var(--bg)" stroke-width="1.7"/></svg>`;

const STYLE = `
:root{--bg:#f7f3ea;--surface:#fffdf8;--ink:#1d1f1c;--muted:#6c6f69;--faint:#9a9d96;--line:#e6e1d6;--accent:#244f3d;--accent-soft:#e3ece6;--serif:ui-serif,"New York","Iowan Old Style",Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#121512;--surface:#1a1e1a;--ink:#ecebe6;--muted:#a3a69f;--faint:#959b94;--line:#2b302b;--accent:#8fc3a6;--accent-soft:#1f2d25}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
main{max-width:1120px;margin:0 auto;padding:20px 16px 72px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:14px;color:var(--muted);margin-bottom:40px}
.bar nav{display:flex;gap:22px}.bar nav a:hover,.bar nav .on{color:var(--ink)}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--ink);font-weight:600;font-size:15px}
.mark{width:22px;height:22px;color:var(--accent)}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:22px}
h1{font:500 clamp(36px,6vw,52px)/1.05 var(--serif);letter-spacing:-.02em;margin:0 0 10px}
.lede{color:var(--muted);margin:0;max-width:40em}
.stats{display:flex;gap:26px;margin:14px 0 0;padding:0;list-style:none;font-size:13px;color:var(--muted)}
.stats li{display:flex;align-items:baseline;gap:7px}
.stats b{display:inline-flex;font:600 24px/1.2 var(--mono);letter-spacing:-.02em;color:var(--ink);transition:color .6s}
.stats b.tick{color:var(--accent)}
.digit{display:inline-block;height:1.2em;line-height:1.2em;overflow:hidden;vertical-align:top}.digit>span{display:flex;flex-direction:column;transition:transform 1.1s cubic-bezier(.2,.8,.2,1)}.digit i{display:block;font-style:normal;height:1.2em;line-height:1.2em}
@media (prefers-reduced-motion:reduce){.digit>span{transition:none}}
.search{position:relative;flex:0 1 320px}
.search input{width:100%;height:40px;padding:0 14px 0 36px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:14px var(--sans)}
.search input:focus{outline:2px solid var(--accent);outline-offset:1px}
.search svg{position:absolute;left:12px;top:12px;width:16px;height:16px;color:var(--faint)}
.tabs{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);margin-bottom:16px}
.tabs ul{display:flex;gap:22px;margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:none}
.tabs ul::-webkit-scrollbar{display:none}
.tabs li a{display:block;padding:10px 0;color:var(--muted);white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs li a:hover{color:var(--ink)}.tabs li a.on{color:var(--ink);border-color:var(--accent)}
.tabs form{display:flex;gap:6px;flex:none}.tabs button{height:30px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--muted);font:13px var(--sans)}
.tabs select{height:30px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--muted);font:13px var(--sans);padding:0 8px;flex:none}
.tape{display:flex;align-items:center;gap:10px;margin:0 0 28px;font-size:13px;color:var(--muted);overflow:hidden}
.tape>span{flex:none;display:inline-flex;align-items:center;gap:6px;color:var(--ink);font-weight:600}
.tape>span:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent)}
.tape ul{display:flex;gap:22px;margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:none;white-space:nowrap}
.tape ul::-webkit-scrollbar{display:none}
.tape time{font-family:var(--mono);font-size:12px;color:var(--faint);margin-right:6px}
.tape a:hover{color:var(--ink)}
section.tab{margin-bottom:34px}
section.tab>h2{font:600 13px var(--sans);letter-spacing:.02em;color:var(--muted);margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:0;padding:0;list-style:none}
@media (max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.grid{grid-template-columns:1fr}.search{flex-basis:100%}.tabs{flex-wrap:wrap;gap:0}.tabs form{order:-1;width:100%;margin-bottom:6px}.tabs select{flex:1}.tabs ul{width:100%}.row:nth-child(n+3){display:none}}
.card{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 16px 12px;transition:border-color .15s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.card h3{display:flex;align-items:center;gap:10px;font:500 18px/1.25 var(--serif);margin:0 0 12px}
.card h3 a:hover{color:var(--accent)}
.glyph{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent-soft);color:var(--accent);font:600 13px var(--sans)}
.rows{list-style:none;margin:0;padding:0;flex:1}
.row a{display:grid;grid-template-columns:1fr 58px;gap:12px;align-items:center;padding:8px;margin:0 -8px;border-radius:9px}
.row a:hover,.row a:focus-visible{background:var(--accent-soft);outline:none}
.row+.row{border-top:1px solid var(--line)}
.q{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;line-height:1.4}
.who{display:block;margin-top:2px;font-size:12px;color:var(--faint)}
.row a:hover .q{color:var(--accent)}
.pill{min-width:58px;padding:6px 10px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:9px;color:var(--accent);font:600 13px var(--mono);text-align:center}
.row a:hover .pill{background:var(--surface)}
.foot-row{display:flex;justify-content:space-between;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--faint)}
.foot-row a{color:var(--muted)}.foot-row a:hover{color:var(--accent)}
.empty{padding:40px 24px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px;margin:0 0 34px}
h2.part{font:500 22px var(--serif);margin:48px 0 12px}
.stores{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
.stores li a{display:grid;grid-template-columns:1fr auto auto;gap:18px;align-items:center;padding:14px 18px}
.stores li+li a{border-top:1px solid var(--line)}
.stores b{font-weight:600}.stores span{font-size:13px;color:var(--muted)}.stores em{font-style:normal;color:var(--accent);font-size:13px;font-weight:600}
.stores li a:hover b{color:var(--accent)}
@media (max-width:640px){.stores li a{grid-template-columns:1fr auto}.stores span{grid-column:1/-1;order:3}}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:40px}
@media (max-width:640px){.panels{grid-template-columns:1fr}}
.panel{border:1px solid var(--line);border-radius:14px;padding:18px 20px;font-size:14px;color:var(--muted)}
.panel h3{font:500 17px var(--serif);color:var(--ink);margin:0 0 6px}
.panel p{margin:0 0 8px}.panel a{color:var(--accent);font-weight:600}
code{font:12.5px var(--mono);background:var(--accent-soft);color:var(--ink);padding:2px 6px;border-radius:6px}
.endpoint{display:block;margin:4px 0 12px;padding:8px 10px;overflow-x:auto;white-space:nowrap;user-select:all}
.crumb{font-size:13px;color:var(--muted);margin:0 0 12px}.crumb a:hover{color:var(--ink)}
.offers{list-style:none;margin:28px 0 0;padding:0;display:flex;flex-direction:column;gap:12px}
.offer{display:grid;grid-template-columns:1fr auto;gap:20px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.offer h2{font:500 20px/1.3 var(--serif);margin:0 0 8px}.offer h2 a:hover{color:var(--accent)}
.offer blockquote{margin:0 0 10px;padding:2px 0 2px 14px;border-left:3px solid var(--accent-soft);font:16px/1.6 var(--serif)}
.offer .fit{margin:0 0 10px;font-size:14px;color:var(--muted)}
.offer .by{margin:0;font-size:13px;color:var(--faint)}.offer .by a{color:var(--muted)}.offer .by a:hover{color:var(--accent)}
.buy{align-self:center}
.go{display:inline-block;padding:8px 14px;border-radius:9px;background:var(--accent);color:var(--bg);font-weight:600;font-size:14px;white-space:nowrap}
.go:hover{filter:brightness(1.08)}
@media (max-width:640px){.offer{grid-template-columns:1fr}.buy .go{display:block;text-align:center}}
.related{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.related a{display:inline-block;padding:6px 12px;border:1px solid var(--line);border-radius:999px;font-size:13px;color:var(--muted);background:var(--surface)}
.related a:hover{border-color:var(--accent);color:var(--ink)}
`;

// Instant search over the cards already drawn; without it the form searches on the server.
// The counts show as they are, then follow /marketplace/stats.json and roll only when a real change lands.
const SCRIPT = `const col="<span class=\\"digit\\" aria-hidden=\\"true\\"><span>"+"0123456789".split("").map(d=>"<i>"+d+"</i>").join("")+"</span></span>";const roll=(b,v)=>{const t=String(v);b.setAttribute("aria-label",t);if(b.dataset.v===t)return;const was=b.dataset.v;b.dataset.v=t;if(!was)return;const from=was.padStart(t.length,"0").slice(-t.length);b.innerHTML=col.repeat(t.length);const cols=[...b.querySelectorAll(".digit>span")];cols.forEach((c,i)=>{c.style.transition="none";c.style.transform="translateY(-"+from[i]+"0%)"});b.offsetHeight;cols.forEach((c,i)=>{c.style.transition="";c.style.transform="translateY(-"+t[i]+"0%)"});b.classList.add("tick");setTimeout(()=>b.classList.remove("tick"),1600)};const stats=[...document.querySelectorAll("[data-stat]")];stats.forEach(b=>roll(b,b.textContent));stats.length&&setInterval(()=>{document.hidden||fetch("/marketplace/stats.json").then(r=>r.ok?r.json():null).then(n=>n&&stats.forEach(b=>typeof n[b.dataset.stat]==="number"&&roll(b,n[b.dataset.stat]))).catch(()=>{})},30000);const f=document.querySelector(".search input[name=q]"),c=[...document.querySelectorAll(".card")],t=[...document.querySelectorAll("section.tab")],e=document.querySelector(".none");f&&f.addEventListener("input",()=>{const q=f.value.trim().toLowerCase();let n=0;for(const k of c){const m=!q||k.dataset.search.includes(q);k.hidden=!m;n+=m}for(const s of t)s.hidden=!s.querySelector(".card:not([hidden])");e&&(e.hidden=n>0)});const s=document.querySelector(".tabs select");s&&s.addEventListener("change",()=>s.form.submit());document.querySelectorAll(".tabs button").forEach(b=>b.remove())`;

const SEARCH_ICON = `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 11l3.5 3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

function page({ title, description, canonical, body, data }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><meta name="description" content="${escape(description)}">
<link rel="canonical" href="${escape(canonical)}"><link rel="alternate" type="application/json" href="${LIST_URL}"><style>${STYLE}</style>
${data ? `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><main><div class="bar"><a class="brand" href="/">${MARK}Lore</a><nav><a class="on" href="/marketplace">Markets</a><a href="/">Get Lore</a></nav></div>
${body}
<div class="panels"><section class="panel"><h3>For agents</h3><p>Every market and listing, as JSON:</p><code class="endpoint">${LIST_URL}</code><p>Each store answers <code>discover</code> for free over MCP and <code>get</code> to buy. A browsing agent can also buy by card on any piece's page.</p><a href="${BUYER_SKILL}">Get the buyer skill →</a></section>
<section class="panel"><h3>Sell what you know</h3><p>Lore turns what you've already written into pieces you approve, then opens a store that pays you directly.</p><a href="${DOWNLOAD}">Download for macOS →</a></section></div>
</main><script>${SCRIPT}</script></body></html>`;
}

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

function tape(exchange) {
  const events = exchange.recent(5);
  if (!events.length) return "";
  const item = (e) =>
    e.row
      ? `<li><a href="${escape(e.row.url)}"><time>${date(e.day)}</time>Updated in ${escape(e.market.name)}: ${escape(clip(e.row.question, 48))}</a></li>`
      : `<li><a href="${escape(e.seller.store)}"><time>${date(e.day)}</time>${escape(e.seller.name)} opened a store</a></li>`;
  return `<div class="tape"><span>Latest</span><ul>${events.map(item).join("")}</ul></div>`;
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
    body: `<p class="crumb"><a href="/marketplace">Markets</a> / <a href="/marketplace?tab=${slug(m.tab)}">${escape(m.tab)}</a></p><h1>${escape(m.name)}</h1>
<ul class="stats"><li><b>${m.rows.length}</b>${m.rows.length === 1 ? "piece" : "pieces"}</li><li><b>${people.length}</b>${people.length === 1 ? "seller" : "sellers"}</li><li><b>${money(Math.min(...m.rows.map((r) => r.price)))}</b>lowest price</li></ul>
<ul class="offers">${m.rows.map(item).join("")}</ul>${nearby.length ? `<h2 class="part">More in ${escape(m.tab)}</h2><ul class="related">${nearby.map((o) => `<li><a href="/marketplace/${o.id}">${escape(o.name)} · ${o.rows.length}</a></li>`).join("")}</ul>` : ""}`,
    data: { "@context": "https://schema.org", "@type": "ItemList", name: m.name, url: `${HOME}/${m.id}`, numberOfItems: m.rows.length, itemListElement: m.rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, item: offer(r) })) }
  });
}

const html = (body, status = 200, cache = "public, max-age=60") =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = url.pathname === "/marketplace.json";
    const stats = url.pathname === "/marketplace/stats.json";
    const [, id] = url.pathname.match(/^\/marketplace\/([a-z0-9-]+)\/?$/) ?? [];
    if (!json && !id && !stats && url.pathname !== "/marketplace" && url.pathname !== "/marketplace/") return env.ASSETS.fetch(request);
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
    if (stats) return Response.json({ markets: exchange.markets.length, pieces: exchange.pieces, sellers: exchange.sellers.length }, { headers: { "cache-control": "public, max-age=30" } });
    if (id) return html(marketPage(exchange, id), exchange.market(id) ? 200 : 404);
    const params = url.searchParams;
    return html(marketplacePage(exchange, { tab: params.get("tab") ?? "", q: params.get("q") ?? "", seller: params.get("seller") ?? "" }));
  }
};
