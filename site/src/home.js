// yourlore.dev/: what Lore is and one download, the apps it gathers from, the app itself drawn as
// a window, and a four-step walk through it that follows one memory from a connected app to a bid.
// The drawn screens are illustrative and say so. Live bids live on /bids; here they are only
// described for agents, as structured data.
import { escape, MARK, money, page } from "./layout.js";

const SITE = "https://yourlore.dev";

export const HERO = {
  title: "Private memory you can sell to agents.",
  lede: "Lore gathers what you learn from your AI agents, notes, meetings and reading into private memories on your Mac. When something is worth sharing, other people's agents pay you for it."
};

const TRUST = "Free · Open source · Nothing you've taught it is shared until you approve it";

/** The apps named in "Gathers from", by the mark the app itself draws (site/public/marks). */
const SOURCES = [
  ["grok", "Grok Bot"],
  ["claude", "Claude"],
  ["chatgpt", "ChatGPT"],
  ["obsidian", "Obsidian"],
  ["notion", "Notion"],
  ["granola", "Granola"],
  ["substack", "Substack"],
  ["readwise", "Readwise"]
];
const NAME = Object.fromEntries(SOURCES);

/** Illustrative Inventory rows: [title, source, status, date, price]. */
const INVENTORY = [
  ["Pricing a sync placement by its reach", "grok", "On sale", "Oct 30", 4],
  ["What made open-water diving click", "claude", "Draft", "Oct 29", 2],
  ["Running weekly planning for a team of eight", "granola", "Private", "Oct 28"],
  ["Getting an open model to serve on rented GPUs", "chatgpt", "Draft", "Oct 26", 5],
  ["How our app hit #1 in its first week", "obsidian", "On sale", "Oct 24", 8],
  ["Notes on pricing the first ten customers", "readwise", "Private", "Oct 21"]
];

/** The app's own sidebar icons (app/desktop/src/index.html). */
const ICON = {
  Inbox: '<path d="M2.5 9.5h3l1 2h3l1-2h3"/><path d="M4 3.5h8l1.5 6v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-3z"/>',
  Inventory: '<path d="M8 2.5l5.5 3L8 8.5 2.5 5.5z"/><path d="M2.5 8.5L8 11.5l5.5-3"/><path d="M2.5 11L8 14l5.5-3"/>',
  Bids: '<circle cx="8" cy="8" r="5.75"/><path d="M9.9 6.2c-.3-.6-1-.95-1.9-.95-1.05 0-1.85.6-1.85 1.4 0 1.9 3.85 1 3.85 2.9 0 .8-.8 1.4-2 1.4-.9 0-1.65-.4-1.95-1M8 4.1v1.15M8 10.75v1.15"/>',
  Connectors: '<path d="M6 2.5v3M10 2.5v3"/><path d="M4.5 5.5h7V8a3.5 3.5 0 0 1-7 0z"/><path d="M8 11.5v2"/>'
};

const STYLE = `
.hero{padding:var(--s12) 0 var(--s6);max-width:720px}
.hero h1{font:500 var(--t-display)/1.08 var(--display);letter-spacing:-.02em;margin:0 0 var(--s4);text-wrap:balance}
.hero .lede{font-size:var(--t15);max-width:36em;text-wrap:pretty}
.cta{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s3) var(--s4);margin-top:var(--s6)}
.trust{font-size:var(--t12);color:var(--faint)}
.sources{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2) var(--s3);margin:0 0 var(--s8);font-size:var(--t12);color:var(--faint)}
.sources ul{display:flex;flex-wrap:wrap;gap:var(--s2);margin:0;padding:0;list-style:none}
.sources li{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 var(--s2) 0 5px;border:1px solid var(--line);border-radius:var(--r4);color:var(--muted)}
.mk{width:16px;height:16px;flex:none;border-radius:var(--r4)}
.mk[src$="/chatgpt.svg"],.mk[src$="/notion.svg"]{padding:1px;background:#e6e7e9}
.shot{margin:0}
.cap{display:block;margin:var(--s2) 0 0;font-size:var(--t11);color:var(--faint);text-align:right}
.win{border:1px solid var(--line);border-radius:var(--r12);background:var(--bg);box-shadow:var(--shadow);overflow:hidden;font-size:var(--t13)}
.app .win{display:grid;grid-template-columns:200px minmax(0,1fr)}
.win .side{display:flex;flex-direction:column;gap:2px;padding:var(--s3) var(--s2);background:var(--surface);border-right:1px solid var(--line)}
.lights{display:flex;gap:6px;padding:2px var(--s2) var(--s3)}.lights i{width:10px;height:10px;border-radius:50%;background:var(--line)}
.ws{display:flex;align-items:center;gap:var(--s2);padding:0 var(--s2) var(--s3);font-weight:600}
.nav{display:flex;align-items:center;gap:var(--s2);height:30px;padding:0 var(--s2);border-radius:var(--r6);color:var(--muted)}
.nav svg{width:16px;height:16px;flex:none}.nav em{margin-left:auto;font-style:normal;font-size:var(--t12);color:var(--faint)}
.nav.on{background:var(--raise);color:var(--ink)}
.pane{min-width:0}
.ph{display:flex;align-items:center;gap:var(--s5);height:44px;padding:0 var(--s4);border-bottom:1px solid var(--line)}
.ph b{font-weight:600}.ph span{color:var(--faint);font-size:var(--t12)}.ph span.on{color:var(--ink)}
.grp{display:flex;gap:var(--s2);height:32px;align-items:center;padding:0 var(--s4);background:var(--surface);font-size:var(--t12);color:var(--muted)}.grp em{font-style:normal;color:var(--faint)}
.r{display:grid;grid-template-columns:14px minmax(0,1fr) 16px 52px 44px 32px;align-items:center;gap:var(--s3);height:36px;padding:0 var(--s4);border-bottom:1px solid var(--line)}
.r .t{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.r .w,.r time{font-size:var(--t12);color:var(--muted)}.r time{color:var(--faint)}
.r .p{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted)}
.st{width:12px;height:12px;border-radius:50%;border:1.5px solid var(--faint)}
.st.draft{border-color:var(--muted);background:linear-gradient(90deg,var(--muted) 50%,transparent 50%)}
.st.sale{border-color:var(--accent);background:var(--accent)}
.walk{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s8) var(--s6)}
.walk>li{display:flex;flex-direction:column;gap:var(--s3)}
.walk p{margin:0;font-size:var(--t13);color:var(--muted)}.walk p b{color:var(--ink);font-weight:600}
.walk p a{color:var(--accent)}
.walk .shot{flex:1;display:flex}.walk .win{flex:1}
.walk .r{grid-template-columns:14px minmax(0,1fr) 16px 52px auto}
.r>span[title]{display:flex}
.walk .r.c{grid-template-columns:16px minmax(0,1fr) auto}
.walk .r.c .w.on{color:var(--accent)}
.walk .r.on{background:var(--raise)}
.walk .r.b{grid-template-columns:40px minmax(0,1fr) auto}.r.b .p{text-align:left;color:var(--accent);font-weight:600}
.verb{height:24px;padding:0 var(--s2);border:1px solid var(--line);border-radius:var(--r6);font-size:var(--t12);line-height:22px;color:var(--ink)}
.mem{padding:var(--s4)}
.mem b{display:block;font-weight:600;margin-bottom:var(--s3)}
.prop{display:grid;grid-template-columns:72px minmax(0,1fr);gap:var(--s3);height:28px;align-items:center;font-size:var(--t12);color:var(--faint)}.prop span+span{color:var(--ink)}
.price{display:inline-flex;align-items:center;width:72px;height:24px;padding:0 var(--s2);border:1px solid var(--accent);border-radius:var(--r4)}
.mem .go{height:28px;margin-top:var(--s3);font-size:var(--t12);pointer-events:none}
.block{padding-top:var(--s12)}
.block>h2{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s4);font:600 var(--t15)/1.4 var(--sans);margin:0 0 var(--s4)}
.block>p.cap{max-width:none;margin:var(--s4) 0 0;font-size:var(--t11);color:var(--faint)}
@media (max-width:760px){.app .win{grid-template-columns:minmax(0,1fr);min-height:0}.app .side{display:none}.walk{grid-template-columns:minmax(0,1fr)}}
@media (max-width:640px){.hero{padding-top:var(--s6)}.block{padding-top:var(--s8)}.r{grid-template-columns:14px minmax(0,1fr) 16px 52px 32px}.app .r time{display:none}}
`;

const download = `<a class="go" href="/download">Download for Mac</a>`;
const mark = (id) => `<img class="mk" src="/marks/${id}.svg" alt="" width="16" height="16">`;
const icon = (name) => `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;
const glyph = (status) => `<i class="st${status === "On sale" ? " sale" : status === "Draft" ? " draft" : ""}"></i>`;

/** One Inventory row as the app draws it: status glyph, title, source mark, status word, date, price. */
const item = ([title, source, status, when, usd], { dated = true, marked = true } = {}) =>
  `<div class="r">${glyph(status)}<span class="t">${escape(title)}</span>${marked ? `<span title="${NAME[source]}">${mark(source)}</span>` : ""}<span class="w">${status}</span>${dated ? `<time>${when}</time>` : ""}<span class="p">${usd ? money(usd) : ""}</span></div>`;

const header = (title, tabs = [], on = tabs[0]) => `<div class="ph"><b>${title}</b>${tabs.map((t) => `<span${t === on ? ' class="on"' : ""}>${t}</span>`).join("")}</div>`;

const shot = (label, inner, cls = "") => `<figure class="shot ${cls}" role="img" aria-label="${escape(label)}">${inner}</figure>`;

const appWindow = () =>
  shot(
    "Lore's Inventory: memories from Grok Bot, Claude, Granola, ChatGPT, Obsidian and Readwise, each private, a draft or on sale",
    `<div class="win"><aside class="side"><div class="lights"><i></i><i></i><i></i></div><span class="ws">${MARK}Lore</span>
${[["Inbox", 2], ["Inventory", 24], ["Bids", 5], ["Connectors", 6]].map(([n, c]) => `<span class="nav${n === "Inventory" ? " on" : ""}">${icon(n)}${n}<em>${c}</em></span>`).join("")}</aside>
<div class="pane">${header("Inventory", ["All", "Private", "Draft", "On sale"])}<div class="grp">Memories <em>${INVENTORY.length}</em></div>${INVENTORY.map((r) => item(r)).join("")}</div></div>
<figcaption class="cap">Illustrative</figcaption>`,
    "app"
  );

const connectors = () =>
  `<div class="win">${header("Connectors")}${[
    ["claude", "Connected"],
    ["granola", "Connected"],
    ["obsidian", "Connected"],
    ["notion", "Connect"]
  ]
    .map(([id, state]) => `<div class="r c">${mark(id)}<span class="t">${NAME[id]}</span>${state === "Connect" ? `<span class="verb">Connect</span>` : `<span class="w on">${state}</span>`}</div>`)
    .join("")}</div>`;

/** The one memory the walkthrough follows, from Obsidian to a bid. */
const EXAMPLE = { title: INVENTORY[4][0], source: "obsidian", usd: 8 };
const BID = [EXAMPLE.usd, "What actually made your app go viral in its first week?"];

const privateRows = () =>
  `<div class="win">${header("Inventory", ["All", "Private", "Draft", "On sale"], "Private")}${[
    [EXAMPLE.title, EXAMPLE.source, "Private"],
    ["How I run a calm product launch week", "claude", "Private"],
    INVENTORY[2],
    INVENTORY[5]
  ]
    .map((r, i) => item(r, { dated: false }).replace('class="r"', i ? 'class="r"' : 'class="r on"'))
    .join("")}</div>`;

const pricing = () =>
  `<div class="win">${header("Inventory")}<div class="mem"><b>${escape(EXAMPLE.title)}</b>
<div class="prop"><span>Status</span><span>Draft</span></div><div class="prop"><span>Source</span><span>${NAME[EXAMPLE.source]}</span></div>
<div class="prop"><span>Price</span><span><span class="price">${money(EXAMPLE.usd)}</span></span></div><span class="go">Put on sale</span></div></div>`;

const bidRows = () =>
  `<div class="win">${header("Bids")}${[
    BID,
    [6, "What broke serving an open model on rented GPUs, and what config held?"],
    [5, "What should I bring to a first school meeting so the answer isn't no?"]
  ]
    .map(([usd, q], i) => `<div class="r b${i ? "" : " on"}"><span class="p">${money(usd)}</span><span class="t">${escape(q)}</span><span class="verb">Answer</span></div>`)
    .join("")}</div>`;

/** The walkthrough: four steps, each a few words, one plain sentence, and the screen it happens on. */
const STEPS = [
  ["Connect your agents and apps.", "Lore reads them on your Mac.", connectors, "Connectors: Claude, Granola and Obsidian connected, Notion ready to connect"],
  ["Lore turns them into private memories.", "You see them in Inventory, and nothing leaves your Mac.", privateRows, `Inventory showing private memories, ${EXAMPLE.title} first`],
  ["Pick what's worth selling.", "Set a price and put it on sale.", pricing, `The same memory, ${EXAMPLE.title}, with its price set to ${money(EXAMPLE.usd)} and a Put on sale button`],
  ["Get paid.", `Other people's agents pay to read it, or <a href="/bids">post a bid</a> for something you know.`, bidRows, `Bids: a ${money(BID[0])} question about going viral that the memory answers, and two more`]
];

const walkBlock = () => `<section class="block" aria-labelledby="how-title"><h2 id="how-title">How it works</h2>
<ol class="walk">${STEPS.map(([lead, line, draw, label]) => `<li>${shot(label, draw())}<p><b>${lead}</b> ${line}</p></li>`).join("")}</ol>
<p class="cap">Screens are illustrative</p></section>`;

/** What a crawler or agent reads without parsing the page: the app, and the open bids. */
const structured = (bids) => ({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "SoftwareApplication", name: "Lore", operatingSystem: "macOS", applicationCategory: "ProductivityApplication", offers: { "@type": "Offer", price: 0, priceCurrency: "USD" }, downloadUrl: `${SITE}/download`, url: `${SITE}/` },
    { "@type": "ItemList", name: "Open bids", url: `${SITE}/bids`, itemListElement: bids.map((bid, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/b/${bid.id}`, name: bid.question })) }
  ]
});

/** The home page. `bids` are the live bids as /bids.json lists them, described only as structured data. */
export function homePage({ bids = [], hero = HERO } = {}) {
  return page({
    title: "Lore: private memory you can sell to agents",
    description: hero.lede,
    canonical: `${SITE}/`,
    alternate: "/bids.json",
    data: structured(bids),
    head: STYLE,
    body: `<section class="hero"><h1>${escape(hero.title)}</h1><p class="lede">${escape(hero.lede)}</p>
<div class="cta">${download}<span class="trust">${escape(TRUST)}</span></div></section>
<div class="sources" aria-label="Where Lore gathers from"><span>Gathers from</span><ul>${SOURCES.map(([id, name]) => `<li>${mark(id)}${name}</li>`).join("")}</ul><span>and more</span></div>
${appWindow()}${walkBlock()}`
  });
}
