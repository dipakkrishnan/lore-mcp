// The pages a person or a browsing agent sees. Agents that speak MCP use /mcp;
// everyone else gets the store at / and one page per publication at /p/<id>.
// Only what `discover` already gives away appears here: the owner's teaser is the
// headline, and neither the title nor the text ever reaches a free page.
import type { Catalog, CatalogEntry } from "./answer-state.js";

export type Store = {
  /** The name the owner chose when listing; empty when unlisted. */
  name: string;
  priceUsd: number;
  origin: string;
  /** Play money: nothing here is really for sale, so no Offer is advertised. */
  test: boolean;
};

/** `section` numbers the piece's topic on the store page, so anchors never collide. */
export type Piece = CatalogEntry & { topic: string; section: number };

const MARKETPLACE = "https://yourlore.dev/marketplace";
const KINDS: Record<string, string> = { claim: "Note", content: "Write-up" };
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
// JSON-LD sits inside <script>; "<" is the one character that can end it early.
const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
const money = (usd: number) => `$${usd < 0.01 ? usd : usd.toFixed(2)}`;
const date = (iso: string) => {
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? iso : day.format(parsed);
};
const anchor = (section: number) => `topic-${section + 1}`;
const label = (topic: string) => topic || "Other";
const seller = (store: Store) => store.name || "A Lore store";
const person = (store: Store) => (store.name ? { "@type": "Person", name: store.name } : undefined);

export const pieces = (catalog: Catalog): Piece[] =>
  Object.entries(catalog.topics).flatMap(([topic, entries], section) => entries.map((entry) => ({ ...entry, topic, section })));

const MARK = `<svg class="mark" viewBox="0 0 26 26" aria-hidden="true"><rect x="4.5" y="5" width="17" height="16" rx="3.2" fill="currentColor"/><path d="M3 11.2L4.5 10.6C8 9.2 10.5 12.2 13 10.9S18.5 9.6 21.5 11.2L23 12M3 16.9L4.5 16.3C8 15 10.5 17.8 13 16.6S18.5 15 21.5 16.8L23 17.7" fill="none" stroke="var(--bg)" stroke-width="1.7"/></svg>`;

const STYLE = `
:root{--bg:#f7f3ea;--surface:#fffdf8;--ink:#1d1f1c;--muted:#6c6f69;--line:#e6e1d6;--accent:#244f3d;--accent-soft:#e3ece6;--serif:ui-serif,"New York",Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#141613;--surface:#1c1f1b;--ink:#ecebe6;--muted:#a3a69f;--line:#2e322d;--accent:#8fc3a6;--accent-soft:#223129}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit}
main{max-width:720px;margin:0 auto;padding:28px 16px 64px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:14px;color:var(--muted);margin-bottom:40px}
.bar a{text-decoration:none}.bar a:hover{color:var(--ink)}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--ink);font-weight:600}
.mark{width:22px;height:22px;color:var(--accent)}
h1{font:500 clamp(30px,6vw,40px)/1.15 var(--serif);letter-spacing:-.01em;margin:0 0 10px}
h1.teaser{font-size:clamp(24px,4.6vw,32px);line-height:1.25;margin-bottom:14px}
.lede{color:var(--muted);font-size:17px;margin:0 0 22px;max-width:36em}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 36px;padding:0;list-style:none}
.chip{display:inline-block;padding:4px 10px;border:1px solid var(--line);border-radius:999px;font-size:13px;color:var(--muted);text-decoration:none;background:var(--surface)}
a.chip:hover{border-color:var(--accent);color:var(--ink)}
h2{font:500 20px/1.3 var(--serif);margin:36px 0 12px;display:flex;align-items:baseline;gap:8px}
h2 small{font:13px var(--sans);color:var(--muted)}
.cards{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.card{display:block;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;text-decoration:none;transition:border-color .12s}
.card:hover{border-color:var(--accent)}
.card h3{font:500 18px/1.35 var(--serif);margin:0 0 10px}
.card p{margin:0 0 10px;color:var(--muted)}
.meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;font-size:13px;color:var(--muted)}
.price{margin-left:auto;font-weight:600;color:var(--ink)}
.go{color:var(--accent);font-weight:600}
.empty{padding:28px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:12px}
.buy{margin:28px 0;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px}
.buy p{margin:0;color:var(--muted)}
.buy p.amount{font:600 30px/1 var(--sans);color:var(--ink);margin:0 0 8px}
.agents{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
.agents h2{font-size:16px;margin:0 0 6px}
.agents p{margin:0}
code{font:13px var(--mono);background:var(--accent-soft);color:var(--ink);padding:2px 6px;border-radius:6px}
.endpoint{display:block;margin:6px 0 12px;padding:8px 10px;overflow-x:auto;white-space:nowrap;user-select:all}
.notice{margin:0 0 28px;padding:12px 16px;border-radius:10px;background:var(--accent-soft);font-size:14px}
.back{display:inline-block;margin-bottom:18px;font-size:14px;color:var(--muted);text-decoration:none}.back:hover{color:var(--ink)}
`;

function page(title: string, description: string, canonical: string, body: string, data: unknown): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(canonical)}">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
<style>${STYLE}</style><script type="application/ld+json">${jsonLd(data)}</script></head>
<body><main><nav class="bar"><a class="brand" href="${MARKETPLACE}">${MARK}Lore</a><a href="${MARKETPLACE}">Marketplace</a></nav>
${body}</main></body></html>`;
}

function offer(store: Store, piece: Piece) {
  if (store.test) return undefined;
  return {
    "@type": "Offer",
    price: String(store.priceUsd),
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
    description: `Paid in USDC by an MCP client at ${store.origin}/mcp.`,
    url: `${store.origin}/p/${piece.id}`,
    seller: person(store)
  };
}

const notice = (store: Store) =>
  store.test ? `<p class="notice">This is a test store. Payments use play money, so nothing here is really for sale yet.</p>` : "";

function agentsNote(store: Store, id?: string): string {
  const call = id ? `<p>Then buy this piece:</p><code class="endpoint">${escape(`get {"id": "${id}"}`)}</code>` : "";
  return `<section class="agents"><h2>For agents</h2><p>Connect over MCP:</p><code class="endpoint">${escape(store.origin)}/mcp</code>${call}<p>Reading the catalog with <code>discover</code> is free; each <code>get</code> pays the seller ${money(store.priceUsd)} in USDC.</p></section>`;
}

export function storefront(catalog: Catalog, store: Store): string {
  const topics = Object.entries(catalog.topics);
  const count = catalog.publication_count;
  const chips = topics.length > 1
    ? `<ul class="chips">${topics.map(([topic, entries], section) => `<li><a class="chip" href="#${anchor(section)}">${escape(label(topic))} · ${entries.length}</a></li>`).join("")}</ul>`
    : "";
  const sections = topics
    .map(
      ([topic, entries], section) =>
        `<section id="${anchor(section)}"><h2>${escape(label(topic))} <small>${entries.length}</small></h2><ul class="cards">${entries
          .map(
            (entry) =>
              `<li><a class="card" href="/p/${escape(entry.id)}"><h3>${escape(entry.teaser)}</h3><div class="meta"><span>${KINDS[entry.kind] ?? escape(entry.kind)}</span><span>${date(entry.updated_at)}</span><span class="price">${money(store.priceUsd)}</span><span class="go">View →</span></div></a></li>`
          )
          .join("")}</ul></section>`
    )
    .join("");
  const name = seller(store);
  const lede = count
    ? `${count} ${count === 1 ? "piece" : "pieces"} of firsthand experience, ${money(store.priceUsd)} each. Descriptions are free to read; every payment goes straight to the seller.`
    : "Nothing for sale yet.";
  const data = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: `${store.origin}/`,
    numberOfItems: count,
    itemListElement: pieces(catalog).map((piece, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: { "@type": "Product", name: piece.teaser, category: label(piece.topic), url: `${store.origin}/p/${piece.id}`, offers: offer(store, piece) }
    }))
  };
  const body = `<h1>${escape(name)}</h1><p class="lede">${lede}</p>${notice(store)}${chips}${sections || '<p class="empty">Nothing for sale yet. Check back soon.</p>'}${agentsNote(store)}`;
  return page(`${name} · Lore`, `${count} firsthand ${count === 1 ? "piece" : "pieces"} for sale on Lore.`, `${store.origin}/`, body, data);
}

export function publicationPage(piece: Piece, store: Store): string {
  const name = seller(store);
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: piece.teaser,
    category: label(piece.topic),
    url: `${store.origin}/p/${piece.id}`,
    brand: person(store),
    offers: offer(store, piece)
  };
  const body = `<a class="back" href="/">← ${escape(name)}</a>
${notice(store)}<ul class="chips"><li><a class="chip" href="/#${anchor(piece.section)}">${escape(label(piece.topic))}</a></li></ul>
<h1 class="teaser">${escape(piece.teaser)}</h1>
<div class="meta"><span>${KINDS[piece.kind] ?? escape(piece.kind)}</span><span>Updated ${date(piece.updated_at)}</span><span>By ${escape(name)}</span></div>
<section class="buy"><p class="amount">${money(store.priceUsd)}</p><p>The full piece is released once it is paid for. Every payment goes straight to the seller; Lore never holds it.</p></section>
${agentsNote(store, piece.id)}`;
  return page(`${piece.teaser} · ${name}`, `A firsthand piece by ${name}, for sale on Lore.`, `${store.origin}/p/${piece.id}`, body, data);
}

export function notFound(store: Store): string {
  const body = `<h1 class="teaser">Not for sale here.</h1><p class="lede">This piece isn't in ${escape(seller(store))}'s store, or it has been taken down.</p><a class="go" href="/">See everything for sale →</a>`;
  return page(`Not found · ${seller(store)}`, "Not for sale here.", `${store.origin}/`, body, { "@context": "https://schema.org", "@type": "WebPage" });
}
