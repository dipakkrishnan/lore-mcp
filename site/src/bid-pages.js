// The bid pages: /bids, where a bid is placed, and /b/:id, one bid with its answers and history.
// Both are plain HTML: the form posts without a script, so people and browsing agents use one path.
import { date, escape, money, page, plural } from "./layout.js";

export const SITE = "https://yourlore.dev";
const HOUR = 3_600_000;
const STATUS = { open: "Open", answered: "Answered", filled: "Filled", expired: "Ended" };
const PROMISE = "If nobody answers in 7 days, the bid ends.";

/** "3 answers", "New" for an unanswered bid under a day old, or null: an empty count says nothing. */
export function answered(bid, now = Date.now()) {
  if (bid.answers.length) return plural(bid.answers.length, "answer");
  return now - Date.parse(bid.created) < 24 * HOUR ? "New" : null;
}

/** "6 days", "5 hours", or null once the bid has ended. */
export function timeLeft(bid, now = Date.now()) {
  const left = Date.parse(bid.expires) - now;
  if (left <= 0 || !["open", "answered"].includes(bid.status)) return null;
  return left >= 48 * HOUR ? plural(Math.round(left / (24 * HOUR)), "day") : left >= HOUR ? plural(Math.floor(left / HOUR), "hour") : "under an hour";
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
<button class="go" type="submit">Place a bid</button><p class="note">No card needed to ask. You read a free preview of each answer and pay only for one you choose to buy. If nobody answers in 7 days, the bid ends. Answers show on the bid's own page.</p></form>`;
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
  `<li class="offer"><div><h2>@${escape(a.handle)}</h2><blockquote>${escape(a.preview)}</blockquote><p class="by">Answered ${date(a.at)}</p></div><div class="buy"><a class="go" href="${escape(a.piece_url)}">Buy · ${money(a.usd)}</a></div></li>`;

/** /b/:id: the question, its amount, market and time left; a way to answer it or pass it on; the answers; and the history. */
export function bidPage(bid, { markets, now = Date.now() }) {
  const left = timeLeft(bid, now);
  const market = bid.market === "unsorted" ? "" : marketName(markets, bid.market);
  const marketLink = markets.some((m) => m.id === bid.market) ? `<a href="/bids?market=${encodeURIComponent(bid.market)}">${escape(market)}</a>` : escape(market);
  const props = [`<b>${money(bid.usd)}</b> offered`, ...(market ? [marketLink] : []), left ? `${left} left` : STATUS[bid.status], ...[answered(bid, now) ?? []].flat()];
  const url = `${SITE}/b/${bid.id}`;
  return page({
    title: bid.question,
    description: `${money(bid.usd)} offered for an answer${market ? `, in ${market}` : ""}.`,
    canonical: url,
    section: "bids",
    alternate: `/b/${bid.id}.json`,
    data: { "@context": "https://schema.org", "@type": "Question", name: bid.question, dateCreated: bid.created, answerCount: bid.answers.length, url },
    body: `<p class="crumb"><a href="/bids">Bids</a></p><h1>${escape(bid.question)}</h1>
<ul class="props">${props.map((p) => `<li>${p}</li>`).join("")}</ul>
${left ? `<div class="actions"><a class="go" href="/download?bid=${escape(bid.id)}">Answer with Lore</a><a class="quiet" data-share href="${escape(url)}">Know someone who knows? Share</a></div>
<p class="note">Answer with Lore gets you the free Mac app. Lore drafts an answer from what your AIs have already saved there, and nothing is sent until you approve it. The buyer reads a free preview, then pays you to read the full answer. ${PROMISE}</p>` : ""}
<h2 class="part">Answers</h2>${bid.answers.length ? `<ul class="offers">${bid.answers.map(answer).join("")}</ul>` : `<p class="empty">No answers yet.</p>`}
<h2 class="part">Activity</h2><ol class="timeline">${bid.events.map(event).join("")}</ol>`
  });
}

export function missingBidPage() {
  return page({
    title: "Bid not found · Lore",
    description: "This bid isn't listed.",
    canonical: `${SITE}/bids`,
    section: "bids",
    alternate: "/bids.json",
    body: `<p class="crumb"><a href="/bids">Bids</a></p><h1>Not listed</h1><p class="lede">No live bid has that address. It may have been taken down.</p><p><a class="go" href="/bids">All bids</a></p>`
  });
}
