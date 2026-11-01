// The home page's one example of what Lore sells, drawn on the server so it reads without a
// script: the top open bids, or, when there are none, pieces listed on the Marketplace. Only
// real records ever show; with neither, the block is left out rather than drawn empty.
import { Exchange } from "./markets.js";

const SHOWN = 3;
const SLOT = /<!-- examples -->[\s\S]*?<!-- \/examples -->/;

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (usd) => (Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const https = (url) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};

/** Open bids a person can act on, biggest first. Anything not shaped like one is dropped. */
async function openBids(reply) {
  const response = await reply();
  if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json")) return [];
  const { bids } = await response.json();
  return (Array.isArray(bids) ? bids : [])
    .filter((b) => b?.status === "open" && typeof b.question === "string" && b.question.trim() && typeof b.usd === "number" && b.usd > 0 && https(b.url))
    .sort((a, b) => b.usd - a.usd || String(b.created).localeCompare(String(a.created)))
    .slice(0, SHOWN);
}

const row = ({ url, title, detail, sample, amount }) =>
  `<li class="card"><a href="${escape(url)}"><b>${escape(title)}</b>${detail ? `<small>${escape(detail)}</small>` : ""}${sample ? `<q>${escape(clip(sample, 100))}</q>` : ""}</a><span class="tag">${amount}</span></li>`;

const block = ({ title, note, more, rows }) =>
  `<section class="window" aria-labelledby="examples-title"><div class="titlebar"><span class="lights" aria-hidden="true"><i></i><i></i><i></i></span><h2 id="examples-title">${title}</h2>${more}</div><p class="note">${note}</p><ul class="cards">${rows.map(row).join("")}</ul></section>`;

function bidBlock(bids, names) {
  return block({
    title: "People are bidding on",
    note: "Open questions. Answer one and the buyer pays what they offered.",
    more: `<a href="/bids">All bids →</a>`,
    rows: bids.map((b) => ({ url: b.url, title: b.question.trim(), detail: names.get(b.market) ?? "", amount: `Offers ${money(b.usd)}` }))
  });
}

function pieceBlock(exchange) {
  const pieces = exchange.markets
    .flatMap((m) => m.rows.filter((r) => !r.seller.test).map((r) => ({ ...r, market: m.name })))
    .filter((p, i, all) => all.findIndex((o) => o.url === p.url) === i)
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, SHOWN);
  if (!pieces.length) return "";
  return block({
    title: "On the Marketplace now",
    note: "Answers people wrote with Lore and chose to sell. Buyers read the first lines free.",
    more: `<a href="/marketplace">Browse →</a>`,
    rows: pieces.map((p) => ({ url: p.url, title: clip(p.question, 110), detail: `${p.market} · from ${p.seller.name}`, sample: p.sample, amount: money(p.price) }))
  });
}

/**
 * The static home page with its example block filled in.
 * `bids` answers like GET /bids.json; `registry` returns the Marketplace list.
 */
export async function homePage(page, { bids, registry, load = (list) => Exchange.load(list) }) {
  const [open, list] = await Promise.all([openBids(bids).catch(() => []), registry().catch(() => null)]);
  const names = new Map((Array.isArray(list?.markets) ? list.markets : []).filter((m) => typeof m?.name === "string").map((m) => [m.id, m.name]));
  let html = "";
  if (open.length) html = bidBlock(open, names);
  else if (list) html = await load(list).then(pieceBlock, () => "");
  return page.replace(SLOT, html);
}
