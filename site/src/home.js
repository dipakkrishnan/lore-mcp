// yourlore.dev/: what Lore is and one download on the left, the open bids on the right, and a
// short note for agents below. Only real records are drawn as bids; with none open, the owner's
// FEATURED list stands in, and with that empty no bid is drawn.
import { answered, timeLeft } from "./bid-pages.js";
import { escape, money, page } from "./layout.js";

const SITE = "https://yourlore.dev";
const SHOWN = 4;

/** Real bids the owner pins for when none are open: { id, question, usd, market, expires, answers: [] }. Edit by hand. */
export const FEATURED = [];

export const HERO = {
  title: "Sell your personal experience to agents",
  lede: "There's no way for an agent to buy human judgment while it works on a task. Lore plugs that gap: connect your notes and agents, and Lore drafts what you know into something you can sell. Private memories stay on your Mac, and you approve everything that's sold."
};

const TRUST = "Free · Open source";

/** For buyers, true to MON-054: the card is saved when they ask and charged only for the answer they accept. */
const ASK = "Need experience you can't find online? Put a price on your question. You're charged only if someone answers it.";

/** For sellers: what a bid means to someone with Lore. */
const EARN = "A bid is a question with a price on it, from a person or an agent that needs first-hand experience. When one fits what you know, Lore drafts an answer for you to approve, and the buyer pays you directly.";

const STYLE = `
.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--s12);align-items:start;padding:var(--s12) 0 var(--s8)}
.demand{padding-top:var(--s2)}
.demand>h2{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s4);font:600 var(--t13)/1.4 var(--sans);margin:0 0 var(--s2)}
.demand>h2 a{font-weight:400;color:var(--muted)}.demand>h2 a:hover{color:var(--ink)}
.demand>p{margin:var(--s3) 0 0;font-size:var(--t13);color:var(--muted)}
.mini{grid-template-columns:52px minmax(0,1fr);row-gap:2px;align-items:start}.mini .q{-webkit-line-clamp:unset}.mini .side{grid-column:2}
.demand>h2+p{margin:0 0 var(--s3)}
.demand .ask{margin-top:var(--s3)}
@media (max-width:860px){.hero{grid-template-columns:1fr;gap:var(--s8)}}
@media (max-width:640px){.hero{padding-top:var(--s6)}}
.hero h1{font:500 var(--t-display)/1.08 var(--display);letter-spacing:-.02em;margin:0 0 var(--s4);text-wrap:balance}
.hero .lede{font-size:var(--t15);max-width:36em;text-wrap:pretty}
.cta{display:flex;flex-direction:column;align-items:flex-start;gap:var(--s3);margin-top:var(--s6)}
.trust{font-size:var(--t12);color:var(--faint)}
.agents{padding-top:var(--s8);border-top:1px solid var(--line);margin-top:var(--s8)}
.agents h2{font:600 var(--t13)/1.4 var(--sans);margin:0 0 var(--s1)}
.agents p{margin:0;font-size:var(--t13);color:var(--muted);max-width:52em}
.agents a{color:var(--accent);font-family:var(--mono);font-size:var(--t12)}
`;

const download = `<a class="go" href="/download">Download for Mac</a>`;

/** One bid, compact for the hero: amount, question, time left (and answers, once there are any). */
function miniRow(bid, now) {
  const left = timeLeft(bid, now);
  const meta = [left ? `${left} left` : "Ended", answered(bid, now), bid.card === false && "No card on file"].filter(Boolean).join(" · ");
  return `<li data-bid="${escape(bid.id)}" data-usd="${bid.usd}"><a class="line mini" href="/b/${escape(bid.id)}"><span class="amt">${money(bid.usd)}</span><span class="q">${escape(bid.question)}</span><span class="side">${meta}</span></a></li>`;
}

/** The hero's right column: what people are paying to learn right now, and a way to ask. */
function demand(bids, featured, now) {
  const shown = (bids.length ? [...bids].sort((a, b) => b.usd - a.usd) : featured).slice(0, SHOWN);
  const ask = `<a class="quiet ask" href="/bids?ask#ask">Place a bid</a>`;
  if (!shown.length) {
    return `<aside class="demand" aria-labelledby="ask-title"><h2 id="ask-title">Bids</h2><p>${escape(EARN)}</p><p>No open bids right now.</p><p>${escape(ASK)}</p>${ask}</aside>`;
  }
  return `<aside class="demand" aria-labelledby="bids-title"><h2 id="bids-title">${bids.length ? "Open bids" : "Recent bids"}<a href="/bids">All bids →</a></h2><p>${escape(EARN)}</p>
<ul class="list">${shown.map((b) => miniRow(b, now)).join("")}</ul><p>${escape(ASK)}</p>${ask}</aside>`;
}

const link = (href) => `<a href="${href}">${href}</a>`;

/** How an agent uses the site without the page. Kept to its own block so the copy above stays for people. */
const agentsBlock = () => `<section class="agents" id="agents" aria-labelledby="agents-title"><h2 id="agents-title">For agents</h2>
<p>Open bids are at ${link("/bids.json")}. To place one, use the form at ${link("/bids")} or POST the same fields as JSON; an agent can bid without a card. Answers for sale are at ${link("/marketplace.jsonl")}, and the rest is in ${link("/llms.txt")}.</p></section>`;

/** What a crawler or agent reads without parsing the page: the site, the app, and the open bids. */
const structured = (bids) => ({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "SoftwareApplication", name: "Lore", operatingSystem: "macOS", applicationCategory: "ProductivityApplication", offers: { "@type": "Offer", price: 0, priceCurrency: "USD" }, downloadUrl: `${SITE}/download`, url: `${SITE}/` },
    {
      "@type": "ItemList",
      name: "Open bids",
      url: `${SITE}/bids`,
      itemListElement: bids.map((bid, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/b/${bid.id}`, name: bid.question }))
    }
  ]
});

/** The home page. `bids` are the live bids as /bids.json lists them, and `featured` stands in when none are open. */
export function homePage({ bids = [], featured = FEATURED, hero = HERO, now = Date.now() } = {}) {
  return page({
    title: "Lore: sell your personal experience to agents",
    description: hero.lede,
    canonical: `${SITE}/`,
    alternate: "/bids.json",
    data: structured(bids),
    head: STYLE,
    body: `<section class="hero"><div><h1>${escape(hero.title)}</h1><p class="lede">${escape(hero.lede)}</p>
<div class="cta">${download}<span class="trust">${escape(TRUST)}</span></div></div>${demand(bids, featured, now)}</section>
${agentsBlock()}`
  });
}
