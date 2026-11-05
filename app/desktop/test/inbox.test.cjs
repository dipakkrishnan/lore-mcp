// APP-283: what the Inbox lists, in what order and words, and where a bid's page stands.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Inbox } = require("../src/inbox.js");

const NOW = Date.parse("2026-11-02T12:00:00Z");
const ago = (/** @type {number} */ ms) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;

/** @param {Partial<BidMatch["bid"]>} [bid] @param {number} [memories] @returns {BidMatch} */
const match = (bid = {}, memories = 3) => ({
  bid: { id: "aaaaaaaaa1", question: "How do you stop reward hacking on long coding tasks?", usd: 40, market: "rl-evals", url: "https://yourlore.dev/b/aaaaaaaaa1", expires: new Date(NOW + 2 * 24 * HOUR).toISOString(), ...bid },
  memories: Array.from({ length: memories }, (_, i) => ({ id: i + 1, title: `Memory ${i + 1}` })),
  score: 0.8,
  strength: "strong"
});

/** @param {Partial<PublicationCandidate>} [over] @returns {PublicationCandidate} */
const draft = (over = {}) => ({ title: "Pricing a sync placement by reach", teaser: "", content: "Answer text", kind: "claim", topic: "pricing", provenance: [1], ...over });

/** @param {Partial<InboxInput>} [over] @returns {InboxInput} */
const input = (over = {}) => ({ bids: [], drafts: [], drafting: new Set(), answered: new Set(), updates: 0, offer: null, problems: [], step: null, checkIn: null, tasks: [], reading: null, ready: [], suggestions: [], sales: [], help: false, ...over });

/** One line per row, as the owner reads it. @param {InboxRow[]} rows */
const read = (rows) => rows.map((row) => [row.amount, row.lead, row.title, row.tail.trim()].filter(Boolean).join(" ") + ` · ${row.verb}`);

test("nothing waiting is no rows, so the Inbox says it's all caught up", () => {
  assert.deepEqual(new Inbox(NOW).rows(input()), []);
});

test("each row is one sentence with one verb, newest first, rows with no time of their own on top", () => {
  const rows = new Inbox(NOW).rows(input({
    bids: [match({ expires: new Date(NOW + 7 * 24 * HOUR - 12 * 60_000).toISOString() })],
    drafts: [draft()],
    problems: [{ key: "granola", name: "Granola", says: "stopped reading", verb: "Fix" }],
    checkIn: { questions: [{ question: "Q?", memory: 1, title: "T" }], why: "", at: ago(6 * HOUR), state: "waiting" },
    sales: [{ kind: "publication", item_id: "a", title: "GEPA prompt tuning notes", price_usd: 8, network: "stripe", payer: "", tx: "pi_1", sold_at: ago(3 * HOUR) }],
    ready: [{ key: "claude", from: "Claude", title: "", memories: 3, selling: 1, saves: 3, at: ago(HOUR) }]
  }));
  assert.deepEqual(read(rows), [
    "Draft ready: “Pricing a sync placement by reach” · Review",
    "Granola stopped reading · Fix",
    "$40 How do you stop reward hacking on long coding tasks? · 3 of your memories answer this · Answer",
    "3 new memories from Claude · 1 worth selling · Review",
    "+$8 Sold “GEPA prompt tuning notes” · View",
    "Check-in: 1 question about today · Answer"
  ]);
  const inbox = new Inbox(NOW);
  assert.deepEqual(rows.map((row) => inbox.age(row.at)), ["", "", "12m", "1h", "3h", "6h"]);
  assert.deepEqual(rows.filter((row) => row.done).map((row) => row.kind), ["bid", "memories", "sale", "checkin"], "Done clears what is news, never a draft or a problem still standing");
});

test("a bid's row follows its answer: matched, being drafted, drafted, approved; a bid's draft is not also a plain draft", () => {
  const bid = match();
  const id = bid.bid.id;
  const tail = (/** @type {Partial<InboxInput>} */ over) => new Inbox(NOW).rows(input({ bids: [bid], ...over })).map((row) => `${row.amount} ${row.tail} ${row.verb}`);
  assert.deepEqual(tail({}), ["$40 · 3 of your memories answer this Answer"]);
  assert.deepEqual(tail({ bids: [match({}, 1)] }), ["$40 · 1 of your memories answers this Answer"]);
  assert.deepEqual(read(new Inbox(NOW).rows(input({ bids: [match({}, 0)] }))), ["$40 How do you stop reward hacking on long coding tasks? · Answer"]);
  assert.deepEqual(tail({ drafting: new Set([id]) }), ["$40 · Lore is drafting your answer Answer"]);
  assert.deepEqual(tail({ drafts: [draft({ bid: id })] }), ["$40 · Your answer is drafted Review"]);
  assert.deepEqual(tail({ answered: new Set([id]) }), ["$40 · Your answer is ready View"]);
  assert.deepEqual(new Inbox(NOW).rows(input({ bids: [match({ expires: ago(1) })] })), [], "a bid that closed leaves the Inbox");
});

test("the other kinds read as plain sentences", () => {
  const rows = new Inbox(NOW).rows(input({
    updates: 2,
    offer: { label: "What you approved isn't on sale yet", action: "Open your store" },
    step: { label: "2 changes aren't live yet", action: "Update store", mark: "update", what: "1 approved, not on your store yet" },
    tasks: [{ version: 1, kind: "setup", title: "Set up your Lore", state: "needs_you", phase: "", updatedAt: ago(2 * HOUR) }],
    ready: [{ key: "grok", from: "Grok Bot", title: "", memories: 0, selling: 0, saves: 2, at: ago(3 * HOUR) }, { key: "sunday", from: "", title: "“What did I read on Sunday?”", memories: 2, selling: 0, saves: 2, at: ago(3.5 * HOUR) }],
    suggestions: [{ at: ago(4 * HOUR), title: "Pricing", count: 1 }],
    sales: [{ kind: "publication", item_id: "a", title: "Notes", price_usd: 0, network: "free", payer: "", tx: "f1", sold_at: ago(5 * HOUR) }],
    help: true
  }));
  assert.deepEqual(read(rows), [
    "Ready to approve: new free parts for 2 pieces on sale · Review",
    "What you approved isn't on sale yet · Open your store",
    "2 changes aren't live yet · 1 approved, not on your store yet · Update store",
    "New to Lore? See how it works · Read",
    "Set up your Lore · Waiting for you · Open",
    "2 saves from Grok Bot · already in your memories · View",
    "“What did I read on Sunday?” · 2 new memories · Review",
    "Lore suggests a collection: “Pricing” · 1 memory · Review",
    "Someone read a free copy of “Notes” · View"
  ]);
});

test("ages read like an inbox and a bid's time left counts down to closed", () => {
  const inbox = new Inbox(NOW);
  assert.deepEqual([ago(5_000), ago(12 * 60_000), ago(5 * HOUR), ago(50 * HOUR), ago(10 * 24 * HOUR), null].map((at) => inbox.age(at)), ["now", "12m", "5h", "2d", "Oct 23", ""]);
  const left = (/** @type {number} */ ms) => inbox.left(new Date(NOW + ms).toISOString());
  assert.deepEqual([left(3 * 24 * HOUR), left(30 * HOUR), left(5 * HOUR), left(10 * 60_000), left(-1)], ["3 days", "30 hours", "5 hours", "under an hour", null]);
  assert.equal(Inbox.posted(match().bid), new Date(NOW - 5 * 24 * HOUR).toISOString(), "a bid opened a week before it closes");
});

/** @param {Partial<BidLook>} [over] @returns {BidLook} */
const look = (over = {}) => ({ match: match(), drafting: false, draft: null, approved: false, dismissed: false, ...over });

test("a bid's page in each state: its status, time left and timeline", () => {
  const inbox = new Inbox(NOW);
  const page = (/** @type {Partial<BidLook>} */ over) => {
    const { state, status, left, activity } = inbox.bid(look(over));
    return { state, status, left, activity: activity.map((entry) => `${entry.actor} ${entry.text}`) };
  };
  const open = "2 days";
  const posted = "The buyer posted this bid for $40";
  const found = "Lore found 3 matching memories";
  assert.deepEqual(page({ match: match({}, 0) }), { state: "unmatched", status: "Open", left: open, activity: [posted, "Lore found nothing you know that answers it"] });
  assert.deepEqual(page({}), { state: "matched", status: "Open", left: open, activity: [posted, found] });
  assert.deepEqual(page({ drafting: true }), { state: "drafting", status: "Drafting", left: open, activity: [posted, found, "Lore is drafting from 3 memories…"] });
  assert.deepEqual(page({ draft: draft({ bid: "aaaaaaaaa1" }) }), { state: "drafted", status: "Answer drafted", left: open, activity: [posted, found, "Lore drafted the answer from 3 memories"] });
  assert.deepEqual(page({ approved: true }), { state: "approved", status: "Answer ready", left: open, activity: [posted, found, "Lore drafted the answer from 3 memories", "You approved the answer"] });
  assert.deepEqual(page({ dismissed: true, draft: draft() }), { state: "dismissed", status: "Dismissed", left: open, activity: [posted, found, "You dismissed this bid"] });
  const ended = page({ match: match({ expires: ago(HOUR) }), draft: draft() });
  assert.deepEqual(ended, { state: "expired", status: "Closed", left: null, activity: [posted, found, "Lore drafted the answer from 3 memories", "The bid closed"] });
  assert.deepEqual(page({ match: match({ expires: ago(HOUR) }), approved: true }).state, "approved", "an approved answer stays approved once the bid closes");
  assert.equal(inbox.bid(look({ match: match({}, 1) })).activity[1].text, "found 1 matching memory");
});

/** APP-288: one line per Bids row, as the owner reads it. @param {BidRow[]} rows */
const lines = (rows) => rows.map((row) => [row.amount, row.question, row.market, row.pill?.label ?? row.left, `${row.strength} bars`].filter(Boolean).join(" · "));

test("Bids lists the matches best first, or the whole board in its order, from what Lore already read", () => {
  const inbox = new Inbox(NOW);
  const strong = match({ id: "aaaaaaaaa1" });
  const good = { ...match({ id: "aaaaaaaaa2", question: "What does a working notarization setup look like?", usd: 25, market: "unsorted", expires: new Date(NOW + 30 * HOUR).toISOString() }, 1), strength: /** @type {const} */ ("good") };
  const unasked = { id: "aaaaaaaaa3", question: "How big should a holdout set be?", usd: 75, market: "ai-research", url: "", expires: new Date(NOW + 4 * 24 * HOUR).toISOString() };
  const closed = { ...unasked, id: "aaaaaaaaa4", expires: ago(HOUR) };
  const sets = { drafting: new Set(), drafted: new Set(), answered: new Set() };
  const matches = [strong, good];
  // The board leaves out the strong match: a look that came back short still shows it, after the board's own.
  const board = [unasked, good.bid, closed];
  assert.deepEqual(lines(inbox.bids({ matches, board, tab: "matches", ...sets })), [
    "$40 · How do you stop reward hacking on long coding tasks? · Rl evals · 2 days · 3 bars",
    "$25 · What does a working notarization setup look like? · 30 hours · 2 bars"
  ]);
  assert.deepEqual(lines(inbox.bids({ matches, board, tab: "all", ...sets })), [
    "$75 · How big should a holdout set be? · Ai research · 4 days · 0 bars",
    "$25 · What does a working notarization setup look like? · 30 hours · 2 bars",
    "$40 · How do you stop reward hacking on long coding tasks? · Rl evals · 2 days · 3 bars"
  ]);
  assert.deepEqual(inbox.bids({ matches: [], board: [], tab: "all", ...sets }), [], "an empty board is no rows");
});

test("a bid the owner is answering says where the answer stands in place of its time left", () => {
  const inbox = new Inbox(NOW);
  const ids = ["aaaaaaaaa1", "aaaaaaaaa2", "aaaaaaaaa3", "aaaaaaaaa4"];
  const matches = ids.map((id) => match({ id }));
  const rows = inbox.bids({ matches, board: [], tab: "matches", drafting: new Set([ids[0], ids[1]]), drafted: new Set([ids[1], ids[2]]), answered: new Set([ids[2]]) });
  assert.deepEqual(rows.map((row) => row.pill), [{ label: "Drafting", tint: "pending" }, { label: "Answer drafted", tint: "pending" }, { label: "Answer ready", tint: "live" }, null]);
  assert.equal(Inbox.unmatched(matches[0].bid).memories.length, 0, "a bid nothing answers opens with no memories, so its page offers no draft");
  assert.equal(inbox.bid(look({ match: Inbox.unmatched(matches[0].bid) })).state, "unmatched");
});

test("APP-282, APP-289: Inventory groups by where memories came from, drafts lead, then the rest newest first, a memory sold alone reads as its piece, and taken-down pieces sit apart", () => {
  /** @param {number} id @param {string} label @param {string} at @returns {MemoryItem} */
  const memory = (id, label, at) => ({ id, title: `Memory ${id}`, project_label: label, status: "private", updated_at: at, sources: [], arrival: id });
  // A piece's topic is the sentence its drafting agent wrote; it never becomes a heading.
  /** @param {number} id @param {number[]} provenance @param {"approved" | "revoked"} state @returns {PublicationItem} */
  const piece = (id, provenance, state) => ({ id, public_id: `p${id}`, title: `Piece ${id}`, topic: `Travel: window seat on United or American; piece ${id}`, state, live: true, provenance });
  const input = { memories: [memory(1, "pricing", ago(HOUR)), memory(2, "hiring", ago(2 * HOUR)), memory(3, "", ago(3 * HOUR)), memory(4, "pricing", ago(4 * HOUR))], pieces: [piece(1, [1], "approved"), piece(2, [2], "revoked"), piece(3, [9], "approved")], drafts: [draft({ topic: "A long sentence about hiring", provenance: [2] })] };
  const all = Inbox.inventory({ ...input, tab: "all" });
  assert.deepEqual(all.counts, { all: 7, private: 4, draft: 1, sale: 2 });
  assert.deepEqual(all.groups.map((group) => [group.name, group.rows.map((row) => `${row.kind}:${row.shelf}`)]), [
    ["hiring", ["draft:draft", "memory:private"]],
    ["pricing", ["piece:sale", "memory:private"]],
    ["Unsorted", ["memory:private", "piece:sale"]]
  ]);
  assert.deepEqual(all.down.map((row) => row.key), ["piece:2"], "a taken-down piece leaves its group");
  assert.deepEqual(all.groups.flatMap((group) => group.rows).filter((row) => row.kind === "memory").map((row) => row.item.id), [2, 4, 3], "memory 1 reads as its piece; memory 2, only drafted, keeps its row");
  assert.equal(all.groups[1].rows[0].from?.id, 1, "a piece carries the memory it was drafted from, for its mark");
  const sale = Inbox.inventory({ ...input, tab: "sale" });
  assert.deepEqual(sale.groups.map((group) => group.name), ["pricing", "Unsorted"]);
  assert.deepEqual(sale.down, []);
  assert.deepEqual(sale.counts, all.counts, "a tab narrows the rows, never the counts");
  const recent = Inbox.inventory({ memories: [memory(5, "", ago(HOUR))], pieces: [{ ...piece(4, [], "approved"), updated_at: ago(24 * HOUR) }], drafts: [], tab: "all" });
  assert.deepEqual(recent.groups[0].rows.map((row) => row.key), ["memory:5", "piece:4"], "a memory updated today sits above a piece from yesterday");
});
