// The bid pages: /bids, where a bid is placed, and /b/:id, one bid with its answers and history.
// Both are plain HTML: the form posts without a script, so people and browsing agents use one path.
import { date, escape, money, page, plural } from "./layout.js";

export const SITE = "https://yourlore.dev";
const HOUR = 3_600_000;
const STATUS = { pending: "Waiting for a card", open: "Open", answered: "Answered", paying: "Paying", filled: "Filled", expired: "Ended" };
const PROMISE = "If nobody answers in 7 days, the bid ends.";
/** What a buyer agrees to when they place a bid (MON-054). */
export const CARD_TERMS =
  "Stripe saves your card now and charges it only when you accept an answer, straight to the person who wrote it. If you don't pick one within 2 days of the first answer, that answer is accepted. If nobody answers in 7 days, the bid ends and nothing is charged.";

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
<label class="check"><input type="checkbox" name="card" value="skip"${values.card === "skip" ? " checked" : ""}><span>I'm an agent placing this bid. Skip the card; it's listed as no card on file.</span></label>
<button class="go" type="submit">Place bid</button><p class="note">${CARD_TERMS}</p></form>`;
}

function event(e) {
  const label = {
    opened: "Opened",
    accepted: e.auto ? "First answer accepted after 2 days" : "Answer accepted",
    declined: "Payment didn't go through",
    card_updated: "Card updated",
    answered: `Answered by @${escape(e.handle)}`,
    filled: `Filled ${e.rail === "x402" ? "in USDC" : "by card"}${/^https:\/\//.test(e.proof ?? "") ? ` · <a href="${escape(e.proof)}">proof</a>` : ""}`,
    expired: "Ended",
    removed: "Removed"
  }[e.type];
  return label ? `<li><time>${date(e.at)}</time>${label}</li>` : "";
}

const answer = (a) =>
  `<li class="offer"><div><h2>@${escape(a.handle)}</h2><blockquote>${escape(a.preview)}</blockquote><p class="by">Answered ${date(a.at)}</p></div><div class="buy"><a class="go" href="${escape(a.piece_url)}">Buy · ${money(a.usd)}</a></div></li>`;

const acceptable = (bid, a, i) =>
  `<li class="offer"><div><h2>@${escape(a.handle)}</h2><blockquote>${escape(a.preview)}</blockquote><p class="by">Answered ${date(a.at)}</p></div><div class="buy"><form method="post" action="/b/${bid.id}/accept"><input type="hidden" name="answer" value="${i}"><button class="go" type="submit">Accept and pay ${money(bid.usd)}</button></form></div></li>`;

const cardButton = (bid, label) => `<form method="post" action="/b/${bid.id}/card"><button class="go" type="submit">${label}</button></form>`;

/** What only the buyer sees: their card's state, what went wrong in plain words, and what to do next. */
function buyerPanel(bid, buyer) {
  const handle = bid.answers[bid.events.findLast((e) => e.type === "accepted")?.answer]?.handle;
  const says = [buyer.error && `<p class="error" role="alert">${escape(buyer.error)}</p>`];
  if (bid.status === "pending") says.push(`<p class="note">Your card isn't saved yet, so this bid isn't listed. Add it to open the bid.</p>${cardButton(bid, "Add your card")}`);
  else if (buyer.problem) says.push(`<p class="error" role="alert">${escape(buyer.problem)} ${handle ? `@${escape(handle)} hasn't been paid. ` : ""}Update your card and we'll try again.</p>${cardButton(bid, "Update your card")}`);
  else if (bid.status === "paying") says.push(`<p class="note">Charging your card${handle ? ` to pay @${escape(handle)}` : ""}. This page shows it once Stripe confirms.</p>`);
  else if (bid.status === "filled" && buyer.receipt) says.push(`<a class="go" href="${escape(buyer.receipt)}">Read the answer</a>`);
  else if (bid.status === "answered") says.push(`<p class="note">Accept the answer you want. If you don't choose, the first one is accepted 2 days after it came in.</p>`);
  says.push(`<p class="note">This is your bid. To manage it from another device, keep this private link: <code>${escape(`${SITE}/b/${bid.id}?key=${buyer.key}`)}</code></p>`);
  return `<section class="mine">${says.filter(Boolean).join("")}</section>`;
}

/** /b/:id: the question, its amount, market and time left; a way to answer it or pass it on; the answers; and the history. The buyer also sees their own panel. */
export function bidPage(bid, { markets, buyer = null, now = Date.now() }) {
  const choosing = buyer && bid.status === "answered" && bid.card && !buyer.problem;
  const answers = bid.answers.map((a, i) => (choosing ? acceptable(bid, a, i) : answer(a))).join("");
  const left = timeLeft(bid, now);
  const market = bid.market === "unsorted" ? "" : marketName(markets, bid.market);
  const marketLink = markets.some((m) => m.id === bid.market) ? `<a href="/bids?market=${encodeURIComponent(bid.market)}">${escape(market)}</a>` : escape(market);
  const props = [`<b>${money(bid.usd)}</b> offered`, bid.card ? "Card on file" : "No card on file", ...(market ? [marketLink] : []), left ? `${left} left` : STATUS[bid.status], ...[answered(bid, now) ?? []].flat()];
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
${buyer ? buyerPanel(bid, buyer) : ""}
${left && !buyer ? `<div class="actions"><a class="go" href="/download?bid=${escape(bid.id)}">Answer with Lore</a><a class="quiet" data-share href="${escape(url)}">Know someone who knows? Share</a></div>
<p class="note">Answer with Lore gets you the free Mac app. Lore drafts an answer from what your AIs have already saved there, and nothing is sent until you approve it. ${bid.card ? "The buyer's card is saved with Stripe and is charged when they accept your answer, straight to you." : "This bid has no card on file, so it's a promise only: you're paid if the buyer buys your answer."} ${PROMISE}</p>` : ""}
<h2 class="part">Answers</h2>${bid.answers.length ? `<ul class="offers">${answers}</ul>` : `<p class="empty">No answers yet.</p>`}
<h2 class="part">Activity</h2><ol class="timeline">${bid.events.map(event).join("")}</ol>
<p class="meta"><a href="/b/${escape(bid.id)}.json">This bid as JSON</a></p>`
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
