// yourlore.dev/: the first screen holds both values side by side: what Lore does for you even
// if you never sell (left), and the live bids that show people pay for what you know (right).
// Below: one memory across your AIs, how a bid gets answered, who it's for, what Lore never
// does, how an agent uses the site, and one download. Only real records are drawn as bids; with
// none open, the owner's FEATURED list stands in, and with that empty no bid is drawn.
import { answered, timeLeft } from "./bid-pages.js";
import { escape, money, page } from "./layout.js";

const SITE = "https://yourlore.dev";
const SHOWN = 4;

/** Real bids the owner pins for when none are open: { id, question, usd, market, expires, answers: [] }. Edit by hand. */
export const FEATURED = [];

export const HERO = {
  title: "Teach one AI. Your other AIs can read it.",
  lede: "Lore is one private memory for Claude, ChatGPT and the other AIs you use, kept on your Mac. Because it knows what you've lived through, when someone puts a price on a question you can answer, Lore drafts the answer and you get paid."
};

const TRUST = "Free · Open source · Nothing you've taught it is shared until you approve it";

/** What "one memory" means, as two moments. */
const RECALL = [
  ["Monday, in Claude", "You mention you stopped eating meat last year."],
  ["Friday, in ChatGPT", "\u201cPlan dinners for next week.\u201d Every one is vegetarian, and you never said so again."]
];

const PEOPLE = [
  { who: "You spent a month getting an open model to serve reliably on rented GPUs.", usd: 120, ask: "What actually broke serving Qwen3 on RunPod, and what config finally held?" },
  { who: "You've shipped five apps through App Store review.", usd: 40, ask: "What got your app rejected, and what got it through on the second try?" },
  { who: "You got your child an IEP after the school district said no.", usd: 25, ask: "What should I bring to the first IEP meeting so the answer isn't no?" }
];

const NEVER = [
  ["Sell anything you haven't approved.", "Every answer is a draft until you read it and say yes."],
  ["Show your memories.", "A buyer sees the answer you approved, never what it was drawn from."],
  ["Hold your money.", "The buyer pays you directly, by card."]
];

/** For buyers, true to MON-054: the card is saved when they ask and charged only for the answer they accept. */
const ASK = "Ask something only someone who has done it can answer. You pay only for the answer you accept.";

/** How an agent uses the site, shown to anyone who reads the page, browser agents included. */
const AGENTS = [
  ["Read the open bids", "/bids.json", "every open bid as JSON: question, amount, market, expiry."],
  ["Place a bid", "/bids", "use the form, or POST question, usd and market as JSON. An agent can bid without a card; the bid is listed as no card on file."],
  ["Search what's for sale", "/marketplace.jsonl", "one line per listed answer, with its price and free sample."],
  ["Everything else", "/llms.txt", "buying over MCP or by card, and the lore-buy skill."]
];

const STYLE = `
.hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:var(--s12);align-items:start;padding:var(--s12) 0 var(--s8)}
.demand{padding-top:var(--s2)}
.demand>h2{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s4);font:600 var(--t13)/1.4 var(--sans);margin:0 0 var(--s2)}
.demand>h2 a{font-weight:400;color:var(--muted)}.demand>h2 a:hover{color:var(--ink)}
.demand>p{margin:var(--s3) 0 0;font-size:var(--t13);color:var(--muted)}
.mini{grid-template-columns:52px minmax(0,1fr) auto}
.demand .ask{margin-top:var(--s3)}
@media (max-width:860px){.hero{grid-template-columns:1fr;gap:var(--s8)}}
@media (max-width:640px){.mini{grid-template-columns:52px minmax(0,1fr)}}
.hero h1{font:500 var(--t-display)/1.08 var(--display);letter-spacing:-.02em;margin:0 0 var(--s4);text-wrap:balance}
.hero .lede{font-size:var(--t15);max-width:36em;text-wrap:pretty}
.cta{display:flex;flex-direction:column;align-items:flex-start;gap:var(--s3);margin-top:var(--s6)}
.trust{font-size:var(--t12);color:var(--faint)}
.block{padding-top:var(--s12)}
.block>h2{display:flex;justify-content:space-between;align-items:baseline;gap:var(--s4);font:600 var(--t15)/1.4 var(--sans);margin:0 0 var(--s1)}
.block>h2 a{font:400 var(--t13) var(--sans);color:var(--muted)}.block>h2 a:hover{color:var(--ink)}
.block>p{margin:0 0 var(--s4);font-size:var(--t13);color:var(--muted);max-width:44em}
.steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:0 0 var(--s6);padding:0;list-style:none;border-top:1px solid var(--line);counter-reset:s}
.steps li{padding:var(--s3) var(--s4) 0 0;font-size:var(--t13);color:var(--muted);counter-increment:s}
.steps li:before{content:counter(s);display:block;margin-bottom:var(--s1);font-size:var(--t12);color:var(--faint)}
.steps b{color:var(--ink);font-weight:600}
.trail{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.trail li{display:grid;grid-template-columns:200px minmax(0,1fr);gap:var(--s4);padding:var(--s4) 0;border-bottom:1px solid var(--line);font-size:var(--t13)}
.trail .k{color:var(--ink);font-weight:600}.trail .k small{display:block;font-weight:400;font-size:var(--t12);color:var(--faint)}
.trail p{margin:0;color:var(--muted)}.trail q{display:block;color:var(--ink);quotes:none}
.trail a{color:var(--accent)}
.people{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.people li{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:var(--s4);padding:var(--s3) 0;border-bottom:1px solid var(--line);font-size:var(--t13)}
.people .who{margin:0;font-size:var(--t13);color:var(--ink)}
.people .ask{color:var(--muted)}.people .ask b{color:var(--accent);font-weight:600;margin-right:var(--s2)}
.never{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.never li{padding:var(--s3) 0;border-bottom:1px solid var(--line);font-size:var(--t13);color:var(--muted)}
.never b{color:var(--ink);font-weight:600;margin-right:var(--s1)}
.agents{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.agents li{display:grid;grid-template-columns:200px minmax(0,1fr);gap:var(--s4);padding:var(--s3) 0;border-bottom:1px solid var(--line);font-size:var(--t13);color:var(--muted)}
.agents b{color:var(--ink);font-weight:600}.agents a{color:var(--accent);font-family:var(--mono);font-size:var(--t12);margin-right:var(--s2)}
.get{padding-top:var(--s16)}
.get h2{font:600 var(--t20)/1.3 var(--sans);margin:0 0 var(--s4)}
@media (max-width:640px){.hero{padding-top:var(--s6)}.block{padding-top:var(--s8)}.steps{grid-template-columns:1fr 1fr;row-gap:var(--s3)}.trail li,.people li,.agents li{grid-template-columns:1fr;gap:var(--s1)}}
`;

const download = `<a class="go" href="/download">Download for Mac</a>`;

/** One bid, compact for the hero: amount, question, time left (and answers, once there are any). */
function miniRow(bid, now) {
  const left = timeLeft(bid, now);
  const meta = [left ? `${left} left` : "Ended", answered(bid, now)].filter(Boolean).join(" · ");
  return `<li data-bid="${escape(bid.id)}" data-usd="${bid.usd}"><a class="line mini" href="/b/${escape(bid.id)}"><span class="amt">${money(bid.usd)}</span><span class="q">${escape(bid.question)}</span><span class="side">${meta}</span></a></li>`;
}

/** The hero's right column: what people are paying to learn right now, and a way to ask. */
function demand(bids, featured, now) {
  const shown = (bids.length ? [...bids].sort((a, b) => b.usd - a.usd) : featured).slice(0, SHOWN);
  const ask = `<a class="quiet ask" href="/bids?ask#ask">Ask a question</a>`;
  if (!shown.length) {
    return `<aside class="demand" aria-labelledby="ask-title"><h2 id="ask-title">Bids</h2><p>A bid is a question with a price on it. None are open right now.</p><p>${escape(ASK)}</p>${ask}</aside>`;
  }
  return `<aside class="demand" aria-labelledby="bids-title"><h2 id="bids-title">${bids.length ? "Questions people will pay you to answer" : "Recent bids"}<a href="/bids">All bids →</a></h2>
<ul class="list">${shown.map((b) => miniRow(b, now)).join("")}</ul><p>${escape(ASK)}</p>${ask}</aside>`;
}

const recallBlock = () => `<section class="block" aria-labelledby="recall-title"><h2 id="recall-title">One memory, every AI</h2>
<p>Lore connects to Claude, ChatGPT and your other AIs. What one learns about you, the others can read. It stays on your Mac.</p>
<ul class="trail">${RECALL.map(([when, what]) => `<li><span class="k">${escape(when)}</span><p>${escape(what)}</p></li>`).join("")}</ul></section>`;

const howBlock = () => `<section class="block" aria-labelledby="how-title"><h2 id="how-title">How a bid gets answered</h2>
<ol class="steps"><li><b>A bid matches</b> something your Lore already knows.</li><li><b>Lore drafts</b> the answer from your memories.</li><li><b>You approve it</b>, or change it, or say no.</li><li><b>The buyer reads a free preview</b>, then pays you for the rest.</li></ol></section>`;

const peopleBlock = () => `<section class="block" aria-labelledby="who-title"><h2 id="who-title">Who it's for</h2>
<p>Example bids.</p>
<ul class="people">${PEOPLE.map((p) => `<li><p class="who">${escape(p.who)}</p><span class="ask"><b>$${p.usd}</b>${escape(p.ask)}</span></li>`).join("")}</ul></section>`;

const neverBlock = () => `<section class="block" aria-labelledby="never-title"><h2 id="never-title">What Lore never does</h2>
<ul class="never">${NEVER.map(([what, why]) => `<li><b>Never ${escape(what[0].toLowerCase() + what.slice(1))}</b>${escape(why)}</li>`).join("")}</ul></section>`;

const agentsBlock = () => `<section class="block" id="agents" aria-labelledby="agents-title"><h2 id="agents-title">For agents</h2>
<p>Every page here works for a browser agent as it does for a person. These addresses skip the page.</p>
<ul class="agents">${AGENTS.map(([what, href, how]) => `<li><b>${escape(what)}</b><span><a href="${href}">${href}</a>${escape(how)}</span></li>`).join("")}</ul></section>`;

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
    title: "Lore: one memory for every AI you use",
    description: hero.lede,
    canonical: `${SITE}/`,
    alternate: "/bids.json",
    data: structured(bids),
    head: STYLE,
    body: `<section class="hero"><div><h1>${escape(hero.title)}</h1><p class="lede">${escape(hero.lede)}</p>
<div class="cta">${download}<span class="trust">${escape(TRUST)}</span></div></div>${demand(bids, featured, now)}</section>
${recallBlock()}${howBlock()}${peopleBlock()}${neverBlock()}${agentsBlock()}
<section class="get"><h2>Get Lore</h2>${download}<p class="trust">Free for Apple silicon Macs. Open the zip, move Lore to Applications, and open it.</p></section>`
  });
}
