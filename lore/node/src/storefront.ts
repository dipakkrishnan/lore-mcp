// The pages a person or a browsing agent sees. Agents that speak MCP use /mcp;
// everyone else gets the store at / and one page per publication at /p/<id>.
// Only what `discover` already gives away appears here: the owner's teaser is the
// headline, the sample and fit lines are free extras the owner approved, and
// neither the title nor the text ever reaches a free page.
import type { Catalog, CatalogEntry } from "./answer-state.js";
import { type Collection, toolName } from "./collections.js";

export type Store = {
  /** The name the owner chose when listing; empty when unlisted. */
  name: string;
  priceUsd: number;
  origin: string;
  /** Play money: nothing here is really for sale, so no Offer is advertised. */
  test: boolean;
  /** Lore's card checkout, set only when this store takes cards. */
  checkout?: string;
  /** Copies of each piece given away before it costs anything (MON-040). */
  freeCopies?: number;
  /** Where buyers write for help or a refund; every page ends with it when set. */
  support?: string;
  /** What a 30-day pass to everything costs agents (MON-045); unset while the feed is off. */
  feedUsd?: number;
};

/** A piece the buyer has paid for, shown to them in full. */
export type Unlocked = { title: string; content: string };

/** `section` numbers the piece's topic on the store page, so anchors never collide. */
export type Piece = CatalogEntry & { topic: string; section: number };

const MARKETPLACE = "https://yourlore.dev/marketplace";
const BUYER_SKILL = "https://github.com/dipakkrishnan/lore-mcp/tree/main/plugins/lore/skills/lore-buy";
const KINDS: Record<string, string> = { claim: "Note", content: "Write-up", collection: "Collection" };
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
.buy h2{margin:0 0 6px;font-size:18px}
.buy .prompt{display:flex;gap:8px;align-items:stretch;margin:12px 0}
.buy .prompt code{flex:1;min-width:0;margin:0;padding:10px 12px;white-space:normal;overflow-wrap:anywhere}
.buy .small{font-size:14px;margin-top:10px}
.buy form{margin:14px 0 4px}
.buy button.card{font-size:16px;padding:12px 22px}
.buy h2.or{margin-top:24px;font-size:16px}
.piece{font:18px/1.7 var(--serif);margin-top:28px}
.piece p{margin:0 0 16px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
button{font:600 14px var(--sans);padding:9px 14px;border-radius:10px;border:1px solid var(--line);background:var(--bg);color:var(--ink);cursor:pointer}
button:hover{border-color:var(--accent)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--bg)}
.fit{list-style:none;margin:22px 0 0;padding:0;display:grid;gap:8px}
.fit li{display:flex;gap:10px;align-items:baseline}
.fit .sign{flex:none;width:18px;font-weight:700;text-align:center}
.fit .yes .sign{color:var(--accent)}.fit .no .sign{color:var(--muted)}
.sample{margin:28px 0 0}
.sample h2{margin:0 0 10px;font-size:16px}
.sample blockquote{margin:0;padding:4px 0 4px 16px;border-left:3px solid var(--accent-soft);font:17px/1.65 var(--serif)}
.sample blockquote p{margin:0 0 12px}
.sample .rest{margin:0;font-size:14px;color:var(--muted)}
.agents{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
.agents h2{font-size:16px;margin:0 0 6px}
.agents p{margin:0}
code{font:13px var(--mono);background:var(--accent-soft);color:var(--ink);padding:2px 6px;border-radius:6px}
.endpoint{display:block;margin:6px 0 12px;padding:8px 10px;overflow-x:auto;white-space:nowrap;user-select:all}
.notice{margin:0 0 28px;padding:12px 16px;border-radius:10px;background:var(--accent-soft);font-size:14px}
.listed{display:inline-flex;align-items:center;gap:6px;margin-top:20px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;font-size:13px;color:var(--muted);text-decoration:none}.listed:hover{border-color:var(--accent);color:var(--ink)}.listed .mark{width:14px;height:14px}
.foot{margin-top:48px;padding-top:16px;border-top:1px solid var(--line);font-size:14px;color:var(--muted)}
.back{display:inline-block;margin-bottom:18px;font-size:14px;color:var(--muted);text-decoration:none}.back:hover{color:var(--ink)}
`;

// Copy and share buttons carry their text in data attributes, so no owner text
// is ever interpolated into script.
const SCRIPT = `document.addEventListener("click",async(e)=>{const b=e.target.closest("[data-copy],[data-share]");if(!b)return;const url=location.href.split("#")[0];if("share" in b.dataset&&navigator.share){try{await navigator.share({title:document.title,url})}catch{}return}await navigator.clipboard.writeText(b.dataset.copy||url);const label=b.textContent;b.textContent="Copied";setTimeout(()=>{b.textContent=label},1500)})`;

const foot = (store: Store) =>
  store.support
    ? `<footer class="foot">Questions, or want a refund? Email the seller at <a href="mailto:${escape(store.support)}">${escape(store.support)}</a>.</footer>`
    : "";

function page(title: string, description: string, canonical: string, body: string, data: unknown): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="canonical" href="${escape(canonical)}">
<meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(canonical)}"><meta property="og:site_name" content="Lore"><meta name="twitter:card" content="summary">
<style>${STYLE}</style><script type="application/ld+json">${jsonLd(data)}</script></head>
<body><main><nav class="bar"><a class="brand" href="${MARKETPLACE}">${MARK}Lore</a><a href="${MARKETPLACE}">Marketplace</a></nav>
${body}</main><script>${SCRIPT}</script></body></html>`;
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

// Listing pushes the listed name and delisting clears it, so a name means listed.
const listed = (store: Store) => (store.name ? `<a class="listed" href="${MARKETPLACE}">${MARK}Listed on Lore marketplace</a>` : "");

function agentsNote(store: Store, id?: string, collection?: Collection): string {
  const [what, tool] = collection ? ["the whole collection", `${toolName(collection)} {}`] : ["this piece", `get {"id": "${id}"}`];
  const call = id ? `<p>Then buy ${what}:</p><code class="endpoint">${escape(tool)}</code>` : "";
  const free = store.freeCopies ? `the first ${store.freeCopies} copies of each piece are free, then ` : "";
  const pays = collection
    ? `one call pays the seller ${money(collection.price_usd)} in USDC for every piece in it`
    : `${free}each <code>get</code> pays the seller ${money(store.priceUsd)} in USDC`;
  const feed = store.feedUsd ? `<p>Or call <code>subscribe</code> once: ${money(store.feedUsd)} for 30 days of everything here, old and new.</p>` : "";
  return `<section class="agents"><h2>For agents</h2><p>Connect over MCP:</p><code class="endpoint">${escape(store.origin)}/mcp</code>${call}<p>Reading the catalog with <code>discover</code> is free; ${pays}.</p>${feed}</section>${listed(store)}`;
}

const worth = (collection: Collection, store: Store) => money(collection.pieces.length * store.priceUsd);
const count = (n: number) => `${n} ${n === 1 ? "piece" : "pieces"}`;

function shelf(sets: Collection[], store: Store): string {
  if (!sets.length) return "";
  const cards = sets
    .map(
      (set) =>
        `<li><a class="card" href="/p/${escape(set.id)}"><h3>${escape(set.title)}</h3><div class="meta"><span>Collection</span><span>${count(set.pieces.length)}</span><span>Worth ${worth(set, store)} separately</span><span class="price">${money(set.price_usd)}</span><span class="go">View →</span></div></a></li>`
    )
    .join("");
  return `<section id="collections"><h2>Collections <small>${sets.length}</small></h2><ul class="cards">${cards}</ul></section>`;
}

export function storefront(catalog: Catalog, store: Store, sets: Collection[] = []): string {
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
  const feed = store.feedUsd ? `<p class="notice">Agents can subscribe: ${money(store.feedUsd)} for 30 days of everything here.</p>` : "";
  const body = `<h1>${escape(name)}</h1><p class="lede">${lede}</p>${notice(store)}${feed}${chips}${shelf(sets, store)}${sections || '<p class="empty">Nothing for sale yet. Check back soon.</p>'}${agentsNote(store)}`;
  return page(`${name} · Lore`, `${count} firsthand ${count === 1 ? "piece" : "pieces"} for sale on Lore.`, `${store.origin}/`, body + foot(store), data);
}

const clip = (text: string, length: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length - 1).trimEnd()}…` : flat;
};
const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const heading = paragraph.trim().match(/^## (.+)$/);
      return heading ? `<h2>${escape(heading[1])}</h2>` : `<p>${escape(paragraph.trim()).replace(/\n/g, "<br>")}</p>`;
    })
    .join("");

function fit(piece: Piece): string {
  const rows = [
    piece.useful_if && `<li class="yes"><span class="sign">✓</span><span>Useful if ${escape(piece.useful_if)}</span></li>`,
    piece.not_useful_if && `<li class="no"><span class="sign">✕</span><span>Not useful if ${escape(piece.not_useful_if)}</span></li>`
  ].filter(Boolean);
  return rows.length ? `<ul class="fit">${rows.join("")}</ul>` : "";
}

const sample = (piece: Piece) =>
  piece.sample
    ? `<section class="sample"><h2>Free sample</h2><blockquote>${paragraphs(piece.sample)}</blockquote><p class="rest">The rest is in the full piece.</p></section>`
    : "";

/** How a person buys: by card when the store takes cards, and always through their own agent. */
function card(piece: Pick<Piece, "id">, store: Store): string {
  if (!store.checkout) return "";
  const note = store.test
    ? "This is a test store: pay with Stripe's test card 4242 4242 4242 4242. No real money moves."
    : "Pay by card through Stripe. The payment goes straight to the seller; Lore never holds it.";
  return `<form method="post" action="${escape(store.checkout)}/create"><input type="hidden" name="origin" value="${escape(store.origin)}"><input type="hidden" name="id" value="${escape(piece.id)}"><button class="primary card" type="submit">Buy for ${money(store.priceUsd)}</button></form>
<p class="small">${note} You come back to this page to read it.</p>`;
}

const share = (url: string) => `<div class="actions"><button data-share>Share</button><button data-copy="${escape(url)}">Copy link</button></div>`;

/** While copies are left, reading free is the one thing to do. */
function free(piece: Pick<Piece, "id">, store: Store, left: number): string {
  return `<section class="buy"><p class="amount">Free</p><form method="post" action="/p/${escape(piece.id)}/free"><button class="primary card" type="submit">Read free</button></form>
<p class="small">${left} of ${store.freeCopies} free copies left. The seller gives the first ${store.freeCopies} away; after that it's ${money(store.priceUsd)}.</p>
${share(`${store.origin}/p/${piece.id}`)}</section>`;
}

function buy(piece: Pick<Piece, "id">, store: Store, left: number, what = "this piece"): string {
  if (left > 0) return free(piece, store, left);
  const url = `${store.origin}/p/${piece.id}`;
  const prompt = `Buy ${what} from Lore for me: ${url}`;
  const settle = store.test
    ? "This store takes play money, so buying here is only a rehearsal."
    : "Every payment goes straight to the seller; Lore never holds it.";
  const agent = store.checkout ? `<h2 class="or">Or buy it with your AI agent</h2>` : `<h2>Buy it with your AI agent</h2>`;
  return `<section class="buy"><p class="amount">${money(store.priceUsd)}</p>${card(piece, store)}${agent}
<p>Paste this into Claude, ChatGPT or any agent that can pay on Lore:</p>
<div class="prompt"><code>${escape(prompt)}</code><button class="${store.checkout ? "" : "primary"}" data-copy="${escape(prompt)}">Copy</button></div>
<p class="small">${settle} No agent set up yet? <a href="${BUYER_SKILL}">Get the buyer skill</a>.</p>
${share(url)}</section>`;
}

export function publicationPage(piece: Piece, store: Store, problem = "", left = 0): string {
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
${notice(store)}${problem ? `<p class="notice">${escape(problem)}</p>` : ""}<ul class="chips"><li><a class="chip" href="/#${anchor(piece.section)}">${escape(label(piece.topic))}</a></li></ul>
<h1 class="teaser">${escape(piece.teaser)}</h1>
<div class="meta"><span>${KINDS[piece.kind] ?? escape(piece.kind)}</span><span>Updated ${date(piece.updated_at)}</span><span>By ${escape(name)}</span></div>
${fit(piece)}${sample(piece)}${buy(piece, store, left)}
${agentsNote(store, piece.id)}`;
  const description = clip(piece.sample || (piece.useful_if && `Useful if ${piece.useful_if}`) || `A firsthand piece by ${name}, for sale on Lore.`, 200);
  return page(`${piece.teaser} · ${name}`, description, `${store.origin}/p/${piece.id}`, body + foot(store), data);
}

/** A collection's page: its pieces' teasers, its one price, and what they'd cost one by one.
 * `store` carries the collection's price and, when it clears the card minimum, the checkout. */
export function collectionPage(set: Collection, entries: Piece[], store: Store, single: number, problem = ""): string {
  const name = seller(store);
  const url = `${store.origin}/p/${set.id}`;
  const cards = entries
    .map((entry) => `<li><a class="card" href="/p/${escape(entry.id)}"><h3>${escape(entry.teaser)}</h3><div class="meta"><span>${KINDS[entry.kind] ?? escape(entry.kind)}</span><span>${date(entry.updated_at)}</span></div></a></li>`)
    .join("");
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: set.title,
    url,
    brand: person(store),
    offers: store.test ? undefined : { "@type": "Offer", price: String(set.price_usd), priceCurrency: "USD", availability: "https://schema.org/InStock", url, seller: person(store) }
  };
  const body = `<a class="back" href="/">← ${escape(name)}</a>
${notice(store)}${problem ? `<p class="notice">${escape(problem)}</p>` : ""}<h1 class="teaser">${escape(set.title)}</h1>
<div class="meta"><span>Collection</span><span>${count(entries.length)}</span><span>Worth ${money(entries.length * single)} separately</span><span>By ${escape(name)}</span></div>
<ul class="cards">${cards}</ul>${buy(set, store, 0, "this collection")}
${agentsNote(store, set.id, set)}`;
  return page(`${set.title} · ${name}`, `A collection of ${count(entries.length)} by ${name}, for sale on Lore.`, url, body + foot(store), data);
}

/** The paid piece, for the buyer holding its receipt. Never cached: the address alone unlocks it. */
export function unlockedPage(piece: Piece, store: Store, unlocked: Unlocked, free = false): string {
  const name = seller(store);
  const thanks = free ? "This copy is free, from the seller." : "Thanks for buying.";
  const body = `<a class="back" href="/">← ${escape(name)}</a>
<p class="notice">${thanks} Keep this page's address: it's your copy, and it opens the piece again.</p>
<h1 class="teaser">${escape(unlocked.title)}</h1>
<div class="meta"><span>${KINDS[piece.kind] ?? escape(piece.kind)}</span><span>Updated ${date(piece.updated_at)}</span><span>By ${escape(name)}</span></div>
<article class="piece">${paragraphs(unlocked.content)}</article>`;
  return page(`${unlocked.title} · ${name}`, `A firsthand piece by ${name}.`, `${store.origin}/p/${piece.id}`, body + foot(store), {
    "@context": "https://schema.org",
    "@type": "WebPage"
  });
}

export function notFound(store: Store): string {
  const body = `<h1 class="teaser">Not for sale here.</h1><p class="lede">This piece isn't in ${escape(seller(store))}'s store, or it has been taken down.</p><a class="go" href="/">See everything for sale →</a>`;
  return page(`Not found · ${seller(store)}`, "Not for sale here.", `${store.origin}/`, body + foot(store), { "@context": "https://schema.org", "@type": "WebPage" });
}
