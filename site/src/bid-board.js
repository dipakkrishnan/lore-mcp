// /bids, drawn as a trading screen in the marketplace's own look: a live ticker of new bids,
// answers and fills, and one column per market with its bids by amount, its top bid beside
// the lowest asking price of its pieces. The page follows /bids/stats.json on the same poll
// the marketplace's Latest strip uses, and every bid is a link whose text is its question.
import { age, agentsPanel, bidForm, marketName, SITE } from "./bid-pages.js";
import { clip, escape, money, page, plural } from "./layout.js";

const TICKER = { opened: "New bid", answered: "Answered", filled: "Filled" };

/** The ticker's items and a key that moves only when a new event lands. */
export function ticker(events, markets, now = Date.now()) {
  const item = (e) => {
    const who = e.type === "answered" ? ` · @${escape(e.data.handle)}` : "";
    return `<li data-k="${e.seq}"><a href="/b/${e.id}"><time>${age(e.at, now)}</time>${TICKER[e.type]} · ${money(e.usd_cents / 100)}${who} · ${escape(marketName(markets, e.market))}: ${escape(clip(e.question, 48))}</a></li>`;
  };
  return { html: events.map(item).join(""), key: events.map((e) => String(e.seq)).join("|") };
}

const lowestAsk = (exchange, id) => {
  const rows = exchange?.market(id)?.rows ?? [];
  return rows.length ? money(Math.min(...rows.map((r) => r.price))) : null;
};

const mark = (bid) => `${bid.id}:${bid.answers.length}`;

const row = (bid, now) =>
  `<li class="bid" data-k="${mark(bid)}"><span><a class="q" href="/b/${bid.id}">${escape(bid.question)}</a><span class="who">${age(bid.created, now)} · ${plural(bid.answers.length, "answer")}</span></span><span class="pill">${money(bid.usd)}</span></li>`;

function column([id, bids], markets, exchange, now) {
  const name = marketName(markets, id);
  const listed = exchange?.market(id);
  const ask = lowestAsk(exchange, id);
  const title = listed ? `<a href="/marketplace/${escape(id)}">${escape(name)}</a>` : escape(name);
  const offered = bids.reduce((sum, b) => sum + b.usd, 0);
  return `<li class="card"><h3><span class="glyph" aria-hidden="true">${escape(name[0] ?? "?")}</span>${title}</h3>
<p class="spread"><span>Top bid <b>${money(bids[0].usd)}</b></span><span>${ask ? `Lowest ask <b>${ask}</b>` : "No pieces yet"}</span></p>
<ul class="rows">${bids.map((b) => row(b, now)).join("")}</ul>
<div class="foot-row"><span>${plural(bids.length, "bid")} · ${money(offered)} offered</span>${listed ? `<a href="/marketplace/${escape(id)}">Open market →</a>` : ""}</div></li>`;
}

/** The columns, one per market with a live bid, the richest first and unsorted last; and a key that moves when a bid or answer does. */
export function board(bids, markets, exchange, now = Date.now()) {
  const byMarket = new Map();
  for (const bid of [...bids].sort((a, b) => b.usd - a.usd || b.created.localeCompare(a.created))) {
    byMarket.set(bid.market, [...(byMarket.get(bid.market) ?? []), bid]);
  }
  const columns = [...byMarket].sort(([a, x], [b, y]) => (a === "unsorted") - (b === "unsorted") || y[0].usd - x[0].usd);
  return { html: columns.map((c) => column(c, markets, exchange, now)).join(""), key: columns.flatMap(([, list]) => list.map(mark)).join("|") };
}

/** The counts the header rolls, and the ticker and board, as the poll reads them. */
export function boardStats(bids, events, markets, exchange, now = Date.now()) {
  const tape = ticker(events, markets, now);
  const columns = board(bids, markets, exchange, now);
  return {
    bids: bids.length,
    offered: bids.reduce((sum, b) => sum + b.usd, 0),
    markets: new Set(bids.map((b) => b.market)).size,
    tape: tape.html,
    tape_key: tape.key,
    board: columns.html,
    board_key: columns.key
  };
}

/** /bids: the trading screen, with the place-a-bid sheet open when a post came back with a mistake. */
export function boardPage({ bids, events, markets, exchange, origin, error, values, now = Date.now() }) {
  const stats = boardStats(bids, events, markets, exchange, now);
  const count = (key, n, label) => `<li><b data-stat="${key}" aria-label="${n}">${n}</b>${label}</li>`;
  const columns = bids.length ? "" : `<p class="empty">No live bids yet. Place the first one.</p>`;
  return page({
    title: "Bids · Lore",
    description: "Live bids for firsthand experience nobody sells yet. Say what you'd pay; people who know it answer.",
    canonical: `${SITE}/bids`,
    section: "bids",
    alternate: "/bids.json",
    agents: agentsPanel(origin),
    body: `<header class="head"><div><h1>Bids</h1>
<ul class="stats">${count("bids", stats.bids, stats.bids === 1 ? "live bid" : "live bids")}${count("offered", stats.offered, "dollars offered")}${count("markets", stats.markets, stats.markets === 1 ? "market" : "markets")}</ul></div>
<details class="sheet"${error ? " open" : ""}><summary class="go">Place a bid</summary>${bidForm(markets, { error, values })}</details></header>
<div class="tape"><span>Live</span><ul data-live="tape" data-key="${escape(stats.tape_key)}">${stats.tape}</ul></div>
<div class="board" data-poll="/bids/stats.json"><ul class="grid" data-live="board" data-key="${escape(stats.board_key)}">${stats.board}</ul>${columns}</div>`
  });
}
