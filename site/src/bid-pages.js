// The bid pages: /bids, where a bid is placed, and /b/:id, one bid with its answers and history.
// Both are plain HTML: the form posts without a script, so people and browsing agents use one path.
import { date, escape, money, page, plural } from "./layout.js";

export const SITE = "https://yourlore.dev";
const HOUR = 3_600_000;
const STATUS = { open: "Open", answered: "Answered", filled: "Filled", expired: "Ended" };
export const PROMISE = "You pay only if you accept an answer. If nobody answers in 7 days, the bid ends.";

/** "6 days", "5 hours", or null once the bid has ended. */
export function timeLeft(bid, now = Date.now()) {
  const left = Date.parse(bid.expires) - now;
  if (left <= 0 || !["open", "answered"].includes(bid.status)) return null;
  return left >= 48 * HOUR ? plural(Math.round(left / (24 * HOUR)), "day") : left >= HOUR ? plural(Math.floor(left / HOUR), "hour") : "under an hour";
}

export function age(iso, now = Date.now()) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

export const marketName = (markets, id) => markets.find((m) => m.id === id)?.name ?? (id === "unsorted" ? "Unsorted" : id);

function options(markets, chosen) {
  const tabs = [...new Set(markets.map((m) => m.tab))];
  const option = (m) => `<option value="${escape(m.id)}"${m.id === chosen ? " selected" : ""}>${escape(m.name)}</option>`;
  return `<option value="">Not sure</option>${tabs.map((t) => `<optgroup label="${escape(t)}">${markets.filter((m) => m.tab === t).map(option).join("")}</optgroup>`).join("")}`;
}

/** The place-a-bid form. It posts to /bids and needs no script; an error comes back in it with what was typed. */
export function bidForm(markets, { error = "", values = {} } = {}) {
  const value = (name) => escape(typeof values[name] === "string" || typeof values[name] === "number" ? values[name] : "");
  return `<form class="bid-form" method="post" action="/bids">${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
<label><span>Your question</span><textarea name="question" rows="3" required minlength="10" maxlength="280" placeholder="What do you want to hear from someone who has done it?">${value("question")}</textarea></label>
<div class="pair"><label><span>You'll pay</span><span class="dollar"><input name="usd" type="number" inputmode="numeric" min="5" max="1000" step="1" required placeholder="20" value="${value("usd")}"></span></label>
<label><span>Market</span><select name="market">${options(markets, values.market)}</select></label></div>
<button class="go" type="submit">Place a bid</button><p class="note">${PROMISE} Answers show on the bid's own page.</p></form>`;
}

const agentsPanel = (origin, json) =>
  `<p>${json ? "This bid, as JSON:" : "Live bids, as JSON:"}</p><code class="endpoint">${escape(`${origin}${json ?? "/bids.json"}`)}</code><p>Place a bid with one <code>POST /bids</code>: <code>question</code>, <code>usd</code> in whole dollars, and optionally <code>market</code> and a <code>callback_url</code> that gets a POST when someone answers. You get back an id and an address to check.</p>`;

const row = (bid, markets, now) =>
  `<li><a href="/b/${bid.id}"><b>${escape(bid.question)}</b><span>${escape(marketName(markets, bid.market))} · ${age(bid.created, now)} · ${plural(bid.answers.length, "answer")}</span><em>${money(bid.usd)}</em></a></li>`;

/** /bids: the form and every live bid. */
export function bidsPage({ bids, markets, origin, error, values, now = Date.now() }) {
  const list = bids.length ? `<ul class="stores">${bids.map((b) => row(b, markets, now)).join("")}</ul>` : `<p class="empty">No live bids yet. Be the first.</p>`;
  return page({
    title: "Bids · Lore",
    description: "Ask for firsthand experience nobody sells yet, and say what you'd pay.",
    canonical: `${SITE}/bids`,
    section: "bids",
    alternate: "/bids.json",
    agents: agentsPanel(origin),
    body: `<header class="head"><div><h1>Bids</h1><p class="lede">Ask for firsthand experience nobody sells yet, and say what you'd pay. People who know it answer with a piece you can buy.</p></div></header>
${bidForm(markets, { error, values })}<h2 class="part">Live bids</h2>${list}`
  });
}

function event(e) {
  const label = {
    opened: "Opened",
    answered: `Answered by @${escape(e.handle)}`,
    filled: `Filled ${e.rail === "x402" ? "in USDC" : "by card"}${/^https:\/\//.test(e.proof ?? "") ? ` · <a href="${escape(e.proof)}">proof</a>` : ""}`,
    expired: "Ended",
    removed: "Removed"
  }[e.type];
  return label ? `<li><time>${date(e.at)}</time>${label}</li>` : "";
}

const answer = (a) =>
  `<li class="offer"><div><h2>@${escape(a.handle)}</h2><blockquote>${escape(a.preview)}</blockquote><p class="by">Answered ${date(a.at)}</p></div><div class="buy"><a class="go" href="${escape(a.piece_url)}">Buy · ${money(a.usd)} →</a></div></li>`;

/** /b/:id: the question, its amount, market and time left, the answers, and the history. */
export function bidPage(bid, { markets, origin, now = Date.now() }) {
  const left = timeLeft(bid, now);
  const market = marketName(markets, bid.market);
  const marketLink = markets.some((m) => m.id === bid.market) ? `<a href="/marketplace/${escape(bid.market)}">${escape(market)}</a>` : escape(market);
  return page({
    title: bid.question,
    description: `${money(bid.usd)} offered for an answer, in ${market}.`,
    canonical: `${SITE}/b/${bid.id}`,
    section: "bids",
    alternate: `/b/${bid.id}.json`,
    agents: agentsPanel(origin, `/b/${bid.id}.json`),
    data: { "@context": "https://schema.org", "@type": "Question", name: bid.question, dateCreated: bid.created, answerCount: bid.answers.length, url: `${SITE}/b/${bid.id}` },
    body: `<p class="crumb"><a href="/bids">Bids</a> / ${marketLink}</p><h1>${escape(bid.question)}</h1>
<ul class="stats"><li><b>${money(bid.usd)}</b>offered</li><li><b>${STATUS[bid.status]}</b>${left ? `${left} left` : ""}</li><li><b>${bid.answers.length}</b>${bid.answers.length === 1 ? "answer" : "answers"}</li></ul>
<p class="note">The buyer pays only if they accept an answer. If nobody answers in 7 days, the bid ends.</p>
<h2 class="part">Answers</h2>${bid.answers.length ? `<ul class="offers">${bid.answers.map(answer).join("")}</ul>` : `<p class="empty">No answers yet.</p>`}
<h2 class="part">History</h2><ol class="timeline">${bid.events.map(event).join("")}</ol>`
  });
}

export function missingBidPage(origin) {
  return page({
    title: "Bid not found · Lore",
    description: "This bid isn't listed.",
    canonical: `${SITE}/bids`,
    section: "bids",
    alternate: "/bids.json",
    agents: agentsPanel(origin),
    body: `<p class="crumb"><a href="/bids">Bids</a></p><h1>Not listed</h1><p class="lede">No live bid has that address. It may have been taken down.</p><p><a class="go" href="/bids">All bids →</a></p>`
  });
}
