// yourlore.dev/marketplace: the Lore sellers list, rendered as a page people and
// browsing agents can read without running a script. The list itself stays in
// the lore-marketplace repo; this only draws it. Every other path is the static site.

const LIST = "https://raw.githubusercontent.com/dipakkrishnan/lore-marketplace/main/marketplace.json";
const LIST_URL = "https://yourlore.dev/marketplace.json";
const BUYER_SKILL = "https://github.com/dipakkrishnan/lore-mcp/tree/main/plugins/lore/skills/lore-buy";
const DOWNLOAD = "https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip";
const MAINNET = "eip155:8453";
const TOPICS_SHOWN = 8;
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (usd) => `$${usd < 0.01 ? usd : usd.toFixed(2)}`;
const date = (iso) => {
  const parsed = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : day.format(parsed);
};

const https = (url) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};
// The list is hand-editable and filed from issues, so only well-formed entries with an https store are shown.
const listed = (seller) =>
  typeof seller?.name === "string" && typeof seller.price_usd === "number" && https(seller.store) && !seller.down_since
    ? { ...seller, topics: Array.isArray(seller.topics) ? seller.topics.map(String) : [], publications: Number(seller.publications) || 0 }
    : null;

const MARK = `<svg class="mark" viewBox="0 0 26 26" aria-hidden="true"><rect x="4.5" y="5" width="17" height="16" rx="3.2" fill="currentColor"/><path d="M3 11.2L4.5 10.6C8 9.2 10.5 12.2 13 10.9S18.5 9.6 21.5 11.2L23 12M3 16.9L4.5 16.3C8 15 10.5 17.8 13 16.6S18.5 15 21.5 16.8L23 17.7" fill="none" stroke="var(--bg)" stroke-width="1.7"/></svg>`;

const STYLE = `
:root{--bg:#f7f3ea;--surface:#fffdf8;--ink:#1d1f1c;--muted:#6c6f69;--line:#e6e1d6;--accent:#244f3d;--accent-soft:#e3ece6;--serif:ui-serif,"New York",Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#141613;--surface:#1c1f1b;--ink:#ecebe6;--muted:#a3a69f;--line:#2e322d;--accent:#8fc3a6;--accent-soft:#223129}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit}
main{max-width:760px;margin:0 auto;padding:28px 16px 64px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px;color:var(--muted);margin-bottom:48px}
.bar a{text-decoration:none}.bar a:hover{color:var(--ink)}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--ink);font-weight:600}
.mark{width:22px;height:22px;color:var(--accent)}
h1{font:500 clamp(32px,6.5vw,46px)/1.1 var(--serif);letter-spacing:-.015em;margin:0 0 12px}
.lede{color:var(--muted);font-size:18px;margin:0 0 28px;max-width:34em}
.filter{width:100%;height:44px;padding:0 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:15px var(--sans);margin:0 0 20px}
.filter:focus{outline:2px solid var(--accent);outline-offset:1px}
.sellers{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px}
.seller{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.seller h2{font:500 22px/1.25 var(--serif);margin:0 0 4px}
.seller h2 a{text-decoration:none}.seller h2 a:hover{color:var(--accent)}
.facts{font-size:14px;color:var(--muted);margin:0 0 14px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 16px;padding:0;list-style:none}
.chip{padding:3px 10px;border:1px solid var(--line);border-radius:999px;font-size:13px;color:var(--muted)}
.visit{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:9px;background:var(--accent);color:var(--bg);font-weight:600;font-size:14px;text-decoration:none}
.visit:hover{filter:brightness(1.08)}
.empty{padding:32px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px}
.foot{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:48px}
@media (max-width:600px){.foot{grid-template-columns:1fr}}
.panel{border:1px solid var(--line);border-radius:14px;padding:18px 20px;font-size:14px;color:var(--muted)}
.panel h3{font:500 17px var(--serif);color:var(--ink);margin:0 0 6px}
.panel p{margin:0 0 8px}
.panel a{color:var(--accent);font-weight:600;text-decoration:none}
code{font:12.5px var(--mono);background:var(--accent-soft);color:var(--ink);padding:2px 6px;border-radius:6px}
.endpoint{display:block;margin:4px 0 12px;padding:8px 10px;overflow-x:auto;white-space:nowrap;user-select:all}
`;

// Filters the already-rendered cards; the page is complete without it.
const FILTER = `const f=document.querySelector(".filter"),c=[...document.querySelectorAll(".seller")],e=document.querySelector(".none");f.hidden=false;f.addEventListener("input",()=>{const q=f.value.trim().toLowerCase();let n=0;for(const s of c){const m=!q||s.dataset.search.includes(q);s.hidden=!m;n+=m}e.hidden=n>0})`;

function sellerCard(seller) {
  const topics = seller.topics;
  const shown = topics.slice(0, TOPICS_SHOWN).map((topic) => `<li class="chip">${escape(topic)}</li>`).join("");
  const more = topics.length > TOPICS_SHOWN ? `<li class="chip">+${topics.length - TOPICS_SHOWN} more</li>` : "";
  const count = seller.publications;
  const facts = [
    ...(seller.network === MAINNET ? [] : ["test store"]),
    `${count} ${count === 1 ? "piece" : "pieces"}`,
    `${money(seller.price_usd)} each`,
    ...(typeof seller.answer_price_usd === "number" ? [`questions ${money(seller.answer_price_usd)}`] : []),
    ...(date(seller.listed) ? [`listed ${date(seller.listed)}`] : [])
  ].join(" · ");
  const search = `${seller.name} ${topics.join(" ")}`.toLowerCase();
  return `<li class="seller" data-search="${escape(search)}"><h2><a href="${escape(seller.store)}">${escape(seller.name)}</a></h2><p class="facts">${facts}</p><ul class="chips">${shown}${more}</ul><a class="visit" href="${escape(seller.store)}">Visit store →</a></li>`;
}

export function marketplacePage(list) {
  const sellers = (Array.isArray(list?.sellers) ? list.sellers : []).map(listed).filter(Boolean).sort((a, b) => b.publications - a.publications);
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Lore marketplace",
    url: "https://yourlore.dev/marketplace",
    numberOfItems: sellers.length,
    itemListElement: sellers.map((seller, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: { "@type": "Person", name: seller.name, url: seller.store, knowsAbout: seller.topics }
    }))
  };
  const body = list
    ? sellers.length
      ? `<input class="filter" type="search" placeholder="Filter by topic or name" aria-label="Filter sellers" hidden><ul class="sellers">${sellers.map(sellerCard).join("")}</ul><p class="empty none" hidden>No seller matches that yet.</p>`
      : `<p class="empty">No stores are listed yet.</p>`
    : `<p class="empty">The list of sellers can't be loaded right now. Try again in a minute.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lore marketplace</title><meta name="description" content="People selling what they learned firsthand. Descriptions are free; every payment goes straight to the seller.">
<link rel="canonical" href="https://yourlore.dev/marketplace"><link rel="alternate" type="application/json" href="${LIST_URL}"><style>${STYLE}</style>
<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script></head>
<body><main><nav class="bar"><a class="brand" href="/">${MARK}Lore</a><a href="/">Get Lore</a></nav>
<h1>Lore marketplace</h1><p class="lede">People selling what they learned firsthand. Each store belongs to one person: reading the descriptions is free, and every payment goes straight to them.</p>
${body}
<div class="foot"><section class="panel"><h3>For agents</h3><p>Every listed store, as JSON:</p><code class="endpoint">${LIST_URL}</code><p>Each store answers <code>discover</code> for free and <code>get</code> to buy.</p><a href="${BUYER_SKILL}">Get the buyer skill →</a></section>
<section class="panel"><h3>Sell what you know</h3><p>Lore turns what you've already written into pieces you approve, then opens a store that pays you directly.</p><a href="${DOWNLOAD}">Download for macOS →</a></section></div>
</main><script>${FILTER}</script></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const json = url.pathname === "/marketplace.json";
    if (!json && url.pathname !== "/marketplace" && url.pathname !== "/marketplace/") return env.ASSETS.fetch(request);
    try {
      const response = await fetch(LIST, { cf: { cacheTtl: 300, cacheEverything: true } });
      if (!response.ok) throw new Error(`marketplace list: ${response.status}`);
      if (json) {
        return new Response(response.body, {
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*" }
        });
      }
      return new Response(marketplacePage(await response.json()), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" }
      });
    } catch {
      if (json) return Response.json({ error: "the seller list can't be loaded right now" }, { status: 502, headers: { "cache-control": "no-store" } });
      // Rendered as "can't be loaded right now"; the page itself still answers.
      return new Response(marketplacePage(null), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }
      });
    }
  }
};
