// APP-270: what the `sales` walk (MON-037, APP-219) checked of a store with sales, now on the loaded renderer with the
// ledger faked: the Inbox carries no earnings, no run log and no sold piece, and a thread stopped days ago is history,
// not Unfinished; Inventory's Sales group sums the ledger, names how each sale was paid, links each receipt as the word
// Receipt, counts a sale that arrives, and shows each piece's page views on hover; the banner's click lands on the On
// sale tab; and a store that can't be reached offers no price link. Which sales are announced, once, and as one banner
// for a burst, is test/unit/ipc.test.cjs's watchSales tests and test/unit/app.test.cjs "announces only sales after the
// last one seen…"; the banner's words for the walk's own sales are pinned at the end of this file. Settings' Activity
// rows (one row for the same push again and again, no agent's cost, a stopped run as history) are
// test/unit/renderer-activity.test.cjs. That no amount is monospace and every amount has even figures is computed style,
// which jsdom does not lay out: the store walk checks it. What these views look like is the walks': views.json names
// the kept walk that scans each.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const PIECE = "0123456789abcdef01234567";
const TITLE = "Live demos beat cold decks";
/** @param {string} tx @param {string} sold_at @param {string} [network] @param {number} [price_usd] @returns {Sale} */
const sale = (tx, sold_at, network = "stripe", price_usd = 3) => ({ kind: "publication", item_id: PIECE, title: TITLE, price_usd, network, payer: "", tx, sold_at });
const OLD = sale("pi_old", "2026-10-01T12:00:00Z");

/** The sales walk's seed: a store with one piece for sale, its live state never probed, and a card sale already in its
 * ledger; four pushes and a capture that stopped days ago in the job log. */
const store = () => emptySnapshot({
  publications: { counts: { active: 1, revoked: 0 }, items: [{ id: 1, public_id: PIECE, title: TITLE, topic: "launches", state: "approved", live: null, provenance: [1] }] },
  node: { url: "https://edge-store.invalid/mcp", agents: null, selling: true, store: "unknown", live: { state: "unreachable", network: null, payout: null, price_usd: null } },
  jobs: { items: [{ id: 1, kind: "capture", status: "incomplete", title: "What to Sell Today", summary: "stopped", count: null, cost_usd: 0.016121, started_at: "2026-10-15T09:00:00+00:00", finished_at: "2026-10-15T09:20:00+00:00" }] }
});

/** @param {Sale[]} ledger */
async function signedIn(ledger, tasks = /** @type {TaskRecord[]} */ ([])) {
  const h = load();
  h.lore.answer("snapshot", store());
  h.lore.answer("sales", () => [...ledger]);
  h.lore.answer("views", { [PIECE]: 42 });
  h.lore.answer("tasks", tasks);
  h.boot();
  await h.idle();
  return h;
}

/** A capture thread left waiting for the owner, last touched at `updatedAt`. @param {string} updatedAt @returns {TaskRecord} */
const stopped = (updatedAt) => ({ version: 1, kind: "capture", title: "Capture a memory", state: "stopped", phase: "Review the capture", updatedAt });

test("the Inbox carries no Earned, no Recent runs, no stats line and no sold piece; a thread stopped days ago is not Unfinished", async () => {
  const h = await signedIn([OLD], [stopped("2026-10-15T09:00:00.000Z")]);
  assert.deepEqual(h.get("sales").map((/** @type {Sale} */ each) => each.tx), ["pi_old"], "the ledger was read on sign-in");
  const inbox = h.text("#content");
  assert.doesNotMatch(inbox, /Earned|earned|Recent runs/);
  assert.ok(!inbox.includes(TITLE), "the piece that sold is not on the Inbox");
  assert.equal(h.document.querySelector("#content .strip"), null, "no stats line");
  assert.ok(!inbox.includes("Unfinished") && !inbox.includes("Capture a memory"), "a thread stopped days ago is history");
  // The rule, not an empty Inbox: the same thread stopped a moment ago is one to finish.
  const fresh = await signedIn([OLD], [stopped(new Date().toISOString())]);
  assert.ok(fresh.text("#content").includes("Capture a memory"), "a thread stopped today is listed");
});

test("Inventory sums the ledger, says how each sale was paid, and links each receipt as a word, not a glyph", async () => {
  const h = await signedIn([OLD]);
  h.call("show", "store");
  await h.idle();
  const content = h.text("#content");
  assert.ok(content.includes("1 sale · $3.00"), content);
  assert.ok(content.includes(`${TITLE} · by card`), content);
  const receipts = h.all("#content a.receipt");
  assert.deepEqual(receipts.map((a) => `${a.textContent} ${a.getAttribute("href")}`), ["Receipt https://dashboard.stripe.com/payments/pi_old"]);
  assert.equal(receipts[0].getAttribute("title"), "See this payment on Stripe");
  assert.ok(!receipts.some((a) => a.closest(".invrow")?.textContent?.includes("↗")), "no arrow glyph in the sale's row");
});

test("a sale that arrives is counted, and an agent's sale says so; each piece shows its page views and sales on hover", async () => {
  const ledger = [OLD];
  const h = await signedIn(ledger);
  h.call("show", "store");
  await h.idle();
  ledger.unshift(sale("pi_new", "2026-10-04T18:00:00Z"));
  h.lore.emit({ type: "sold" });
  await h.idle();
  assert.ok(h.text("#content").includes("2 sales · $6.00"), h.text("#content"));
  ledger.unshift(...[5, 4, 3, 2, 1].map((n) => sale(`0xtx${n}`, `2026-10-04T19:0${n}:00Z`, "eip155:8453", 0.5)));
  h.lore.emit({ type: "sold" });
  await h.idle();
  const content = h.text("#content");
  assert.ok(content.includes("7 sales · $8.50"), content);
  assert.ok(content.includes(`${TITLE} · by an agent`), content);
  const agentReceipt = h.all("#content a.receipt").find((a) => a.getAttribute("href")?.endsWith("/tx/0xtx5"));
  assert.equal(agentReceipt?.textContent, "Receipt");
  assert.equal(agentReceipt?.getAttribute("title"), "See this payment on Basescan");
  const hints = h.all("#content .invrow .acts .sub").map((node) => node.textContent);
  assert.deepEqual(hints, ["42 views · 7 sold"], "the piece's row, on hover: its page views and how many sold");
});

test("a sale banner's click opens Inventory on the On sale tab", async () => {
  const h = await signedIn([OLD]);
  assert.equal(h.text("#title"), "Inbox");
  // What main sends when the owner clicks the banner (test/unit/ipc.test.cjs: "…opens the store from the banner").
  h.lore.emit({ type: "show", view: "store" });
  await h.idle();
  assert.equal(h.text("#title"), "Inventory");
  const tab = h.document.querySelector(".ptab[aria-selected=true]");
  assert.ok(tab?.textContent?.startsWith("On sale"), tab?.textContent ?? "no tab selected");
  assert.ok(h.text("#content").includes(TITLE));
});

test("a store that can't be reached, with no price set, offers no price link it can't act on", async () => {
  const h = await signedIn([OLD]);
  h.call("show", "store");
  await h.idle();
  assert.ok(!h.text("#content").includes("Set a price"), h.text("#content"));
});

test("the walk's own banners: one card sale by name and how it was paid, five agent sales as one total", () => {
  const { announcements } = require("../../src/sales.cjs");
  assert.deepEqual(announcements([sale("pi_new", "2026-10-04T18:00:00Z")]), [{ title: "You sold a piece", body: `${TITLE} · $3.00 by card` }]);
  const five = [1, 2, 3, 4, 5].map((n) => sale(`0xtx${n}`, `2026-10-04T19:0${n}:00Z`, "eip155:8453", 0.5));
  assert.deepEqual(announcements(five), [{ title: "You sold 5 pieces", body: "$2.50" }]);
});
