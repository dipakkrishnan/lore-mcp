// /bids: every live bid as one row (amount · question · market · time left · answers), the
// biggest first, with the markets that have bids as text tabs. The rows follow
// /bids/stats.json on the site's poll, and every row is a link to the bid's own page.
import { answered, bidForm, marketName, SITE, timeLeft } from "./bid-pages.js";
import { escape, money, page, plural } from "./layout.js";

const mark = (bid) => `${bid.id}:${bid.answers.length}`;
/** Bids with a card behind them first (MON-054), then the biggest. */
const biggestFirst = (bids) => [...bids].sort((a, b) => b.card - a.card || b.usd - a.usd || b.created.localeCompare(a.created));

/** One bid as a row. A bid with no market shows none, rather than a made-up "Unsorted". */
export function bidRow(bid, markets, now = Date.now()) {
  const market = bid.market === "unsorted" ? "" : marketName(markets, bid.market);
  const left = timeLeft(bid, now);
  const count = answered(bid, now);
  return `<li data-k="${mark(bid)}" data-bid="${escape(bid.id)}" data-usd="${bid.usd}"><a class="line" href="/b/${escape(bid.id)}"><span class="amt">${money(bid.usd)}</span><span class="q">${escape(bid.question)}</span><span class="side">${market ? `<span class="mk">${escape(market)}</span>` : ""}<span>${left ? `${left} left` : "Ended"}</span>${count ? `<span>${count}</span>` : ""}${bid.card ? "" : "<span>No card on file</span>"}</span></a></li>`;
}

/** The rows for one market (or all), and a key that moves when a bid or an answer does. */
export function board(bids, markets, market = "", now = Date.now()) {
  const shown = biggestFirst(bids.filter((b) => !market || b.market === market));
  if (!shown.length) return { html: `<li class="empty">No open bids${market ? " in this market" : ""} yet. Place the first one.</li>`, key: "" };
  return { html: shown.map((b) => bidRow(b, markets, now)).join(""), key: shown.map(mark).join("|") };
}

/** What the poll reads: the counts and the rows. */
export function boardStats(bids, markets, market = "", now = Date.now()) {
  const rows = board(bids, markets, market, now);
  return { bids: bids.length, offered: bids.reduce((sum, b) => sum + b.usd, 0), board: rows.html, board_key: rows.key };
}

function tabs(bids, markets, current) {
  const counts = new Map();
  for (const b of bids) if (b.market !== "unsorted") counts.set(b.market, (counts.get(b.market) ?? 0) + 1);
  const tab = (id, name, n) =>
    `<li><a href="/bids${id ? `?market=${encodeURIComponent(id)}` : ""}"${id === current ? ' class="on" aria-current="page"' : ""}>${escape(name)}<small>${n}</small></a></li>`;
  const named = [...counts].sort(([, a], [, b]) => b - a).map(([id, n]) => tab(id, marketName(markets, id), n));
  return `<nav class="tabs" aria-label="Markets"><ul>${tab("", "All", bids.length)}${named.join("")}</ul></nav>`;
}

/** /bids, with the place-a-bid form open when asked for (?ask) or when a post came back with a mistake. */
export function boardPage({ bids, markets, market = "", ask = false, error, values, now = Date.now() }) {
  const current = bids.some((b) => b.market === market) ? market : "";
  const stats = boardStats(bids, markets, current, now);
  const poll = `/bids/stats.json${current ? `?market=${encodeURIComponent(current)}` : ""}`;
  return page({
    title: "Bids · Lore",
    description: "Questions people will pay to have answered by someone who has done it.",
    canonical: `${SITE}/bids`,
    section: "bids",
    alternate: "/bids.json",
    data: { "@context": "https://schema.org", "@type": "ItemList", name: "Open bids", url: `${SITE}/bids`, itemListElement: biggestFirst(bids.filter((b) => !current || b.market === current)).map((b, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/b/${b.id}`, name: b.question })) },
    body: `<header class="head"><div><h1>Bids</h1><p class="lede">Questions with a price on them. You're charged only if someone answers yours.</p>
<p class="meta">${plural(stats.bids, "open bid")} · ${money(stats.offered)} offered · <a href="/bids.json">As JSON</a> · <a href="/llms.txt">For agents</a></p></div>
<details class="sheet" id="ask"${error || ask ? " open" : ""}><summary class="go">Place a bid</summary>${bidForm(markets, { error, values })}</details></header>
${tabs(bids, markets, current)}
<div data-poll="${escape(poll)}"><ul class="list" data-live="board" data-key="${escape(stats.board_key)}">${stats.board}</ul></div>`
  });
}
