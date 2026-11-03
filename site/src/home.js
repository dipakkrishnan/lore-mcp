// yourlore.dev/: the first screen holds both values side by side: what Lore does for you even
// if you never sell (left), and the live bids that show people pay for what you know (right).
// Below: one memory across your AIs, one real piece end to end, who it's for, what Lore never
// does, and one download. Only real records are drawn as bids; with none open, the owner's
// FEATURED list stands in, and with that empty no bid is drawn. Anything illustrative says so.
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

/** The one worked example: a real public piece, with the steps around it marked for what they are. */
const EXAMPLE = {
  piece: "https://lore.dipakrkrishnan.workers.dev/p/fff411212f0157275f3fbb59",
  question: "Which training choices turned an overwhelming first open-water dive into reliable skills, and which drills mattered most?",
  memory: "Learned to dive at Buddy Dive, Bonaire, Sept 2026, one-on-one. First sessions felt overwhelming: regulator, instructions, buoyancy all at once. What made it click, and the drills that mattered.",
  sample:
    "I learned to dive at Buddy Dive Resort in Bonaire in September 2026, one-on-one with my instructor. My first pool and open-water sessions felt overwhelming: breathing through a regulator, following instructions underwater and managing buoyancy all at once in a new physical environment.",
  price: "$1"
};

/** What "one memory" means, as two moments. Illustrative, and labelled so. */
const RECALL = [
  ["Monday, in Claude", "You mention you get seasick, so you only dive from shore."],
  ["Friday, in ChatGPT", "\u201cPlan my week in Bonaire.\u201d It plans shore dives and no boat days, without being told again."]
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
const ASK = "Ask something only someone who has done it can answer. Your card is saved when you ask and charged only for the answer you accept.";

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
.get{padding-top:var(--s16)}
.get h2{font:600 var(--t20)/1.3 var(--sans);margin:0 0 var(--s4)}
@media (max-width:640px){.hero{padding-top:var(--s6)}.block{padding-top:var(--s8)}.steps{grid-template-columns:1fr 1fr;row-gap:var(--s3)}.trail li,.people li{grid-template-columns:1fr;gap:var(--s1)}}
`;

const download = `<a class="go" href="/download">Download for Mac</a>`;

/** One bid, compact for the hero: amount, question, time left (and answers, once there are any). */
function miniRow(bid, now) {
  const left = timeLeft(bid, now);
  const meta = [left ? `${left} left` : "Ended", answered(bid, now)].filter(Boolean).join(" · ");
  return `<li><a class="line mini" href="/b/${escape(bid.id)}"><span class="amt">${money(bid.usd)}</span><span class="q">${escape(bid.question)}</span><span class="side">${meta}</span></a></li>`;
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
<p>Sign in with Claude or ChatGPT, and Lore adds itself to the AIs you use as a connector, the way you would add Google Drive. They save what they learn about you to Lore, and read it back in any app. It stays on your Mac, and it is worth having even if you never sell a thing.</p>
<ul class="trail">${RECALL.map(([when, what]) => `<li><span class="k">${escape(when)}<small>Illustrative</small></span><p>${escape(what)}</p></li>`).join("")}</ul></section>`;

const howBlock = () => `<section class="block" aria-labelledby="how-title"><h2 id="how-title">How a bid gets answered</h2>
<p>Answering costs you nothing to write. Lore already holds what you know. Here is a real one from Dipak, who makes Lore.</p>
<ol class="steps"><li><b>A bid matches</b> something your Lore already knows.</li><li><b>Lore drafts</b> the answer from your memories.</li><li><b>You approve it</b>, or change it, or say no.</li><li><b>The buyer reads a free preview</b>, then pays you to read it all.</li></ol>
<ul class="trail">
<li><span class="k">The question<small>Illustrative</small></span><p><q>${escape(EXAMPLE.question)}</q></p></li>
<li><span class="k">What Lore kept<small>Private, on Dipak's Mac. Shown in outline</small></span><p>${escape(EXAMPLE.memory)}</p></li>
<li><span class="k">What Dipak approved<small>Real. The free first lines of his answer</small></span><p><q>${escape(EXAMPLE.sample)}</q></p></li>
<li><span class="k">The answer<small>Real, on sale</small></span><p>${EXAMPLE.price}, sample free. <a href="${EXAMPLE.piece}">Read it</a></p></li>
</ul></section>`;

const peopleBlock = () => `<section class="block" aria-labelledby="who-title"><h2 id="who-title">Who it's for</h2>
<p>Anyone who has done something the hard way. The bids beside each are examples.</p>
<ul class="people">${PEOPLE.map((p) => `<li><p class="who">${escape(p.who)}</p><span class="ask"><b>$${p.usd}</b>${escape(p.ask)}</span></li>`).join("")}</ul></section>`;

const neverBlock = () => `<section class="block" aria-labelledby="never-title"><h2 id="never-title">What Lore never does</h2>
<ul class="never">${NEVER.map(([what, why]) => `<li><b>Never ${escape(what[0].toLowerCase() + what.slice(1))}</b>${escape(why)}</li>`).join("")}</ul></section>`;

/** The home page. `bids` are the live bids as /bids.json lists them, and `featured` stands in when none are open. */
export function homePage({ bids = [], featured = FEATURED, hero = HERO, now = Date.now() } = {}) {
  return page({
    title: "Lore: one memory for every AI you use",
    description: hero.lede,
    canonical: `${SITE}/`,
    alternate: "/bids.json",
    head: STYLE,
    body: `<section class="hero"><div><h1>${escape(hero.title)}</h1><p class="lede">${escape(hero.lede)}</p>
<div class="cta">${download}<span class="trust">${escape(TRUST)}</span></div></div>${demand(bids, featured, now)}</section>
${recallBlock()}${howBlock()}${peopleBlock()}${neverBlock()}
<section class="get"><h2>Get Lore</h2>${download}<p class="trust">Free for Apple silicon Macs. Open the zip, move Lore to Applications, and open it.</p></section>`
  });
}
