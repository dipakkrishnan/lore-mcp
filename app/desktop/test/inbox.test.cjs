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
const read = (rows) => rows.map((row) => [row.lead, row.title, row.tail.trim()].filter(Boolean).join(" ") + ` · ${row.verb}`);

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
    "A $40 bid matches what you know: “How do you stop reward hacking on long coding tasks?” · Answer",
    "3 new memories from Claude · 1 worth selling · Review",
    "Sold “GEPA prompt tuning notes” · $8 · View",
    "Check-in: 1 question about today · Answer"
  ]);
  const inbox = new Inbox(NOW);
  assert.deepEqual(rows.map((row) => inbox.age(row.at)), ["", "", "12m", "1h", "3h", "6h"]);
  assert.deepEqual(rows.filter((row) => row.done).map((row) => row.kind), ["bid", "memories", "sale", "checkin"], "Done clears what is news, never a draft or a problem still standing");
});

test("a bid's row follows its answer: matched, being drafted, drafted, approved; a bid's draft is not also a plain draft", () => {
  const bid = match();
  const id = bid.bid.id;
  const lead = (/** @type {Partial<InboxInput>} */ over) => new Inbox(NOW).rows(input({ bids: [bid], ...over })).map((row) => `${row.lead} ${row.verb}`);
  assert.deepEqual(lead({}), ["A $40 bid matches what you know: Answer"]);
  assert.deepEqual(lead({ drafting: new Set([id]) }), ["Lore is drafting your answer: Answer"]);
  assert.deepEqual(lead({ drafts: [draft({ bid: id })] }), ["Your answer is drafted: Review"]);
  assert.deepEqual(lead({ answered: new Set([id]) }), ["Your answer is ready: View"]);
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

test("a bid's page in each state: what it says, its status and its timeline", () => {
  const inbox = new Inbox(NOW);
  const page = (/** @type {Partial<BidLook>} */ over) => {
    const { state, status, lede, activity } = inbox.bid(look(over));
    return { state, status, lede, activity: activity.map((entry) => entry.text) };
  };
  const open = "A buyer will pay $40 for a first-hand answer. Closes in 2 days.";
  const posted = "Bid posted for $40";
  const found = "Lore found 3 matching memories";
  assert.deepEqual(page({ match: match({}, 0) }), { state: "unmatched", status: "Open", lede: open, activity: [posted, "Lore found nothing you know that answers it"] });
  assert.deepEqual(page({}), { state: "matched", status: "Open", lede: open, activity: [posted, found] });
  assert.deepEqual(page({ drafting: true }), { state: "drafting", status: "Drafting", lede: open, activity: [posted, found, "Drafting from 3 memories…"] });
  assert.deepEqual(page({ draft: draft({ bid: "aaaaaaaaa1" }) }), { state: "drafted", status: "Answer drafted", lede: open, activity: [posted, found, "Drafted from 3 memories"] });
  assert.deepEqual(page({ approved: true }), { state: "approved", status: "Answer ready", lede: open, activity: [posted, found, "Drafted from 3 memories", "Approved"] });
  assert.deepEqual(page({ dismissed: true, draft: draft() }), { state: "dismissed", status: "Dismissed", lede: open, activity: [posted, found, "Dismissed"] });
  const ended = page({ match: match({ expires: ago(HOUR) }), draft: draft() });
  assert.deepEqual(ended, { state: "expired", status: "Closed", lede: "A buyer offered $40 for a first-hand answer. It closed Nov 2.", activity: [posted, found, "Drafted from 3 memories", "Bid closed"] });
  assert.deepEqual(page({ match: match({ expires: ago(HOUR) }), approved: true }).state, "approved", "an approved answer stays approved once the bid closes");
  assert.equal(inbox.bid(look({ match: match({}, 1) })).activity[1].text, "Lore found 1 matching memory");
});
