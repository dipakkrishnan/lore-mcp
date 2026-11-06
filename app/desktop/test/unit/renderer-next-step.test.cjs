// APP-268: the Inbox's one next step (Today's, until APP-283) as a table over the stages the `today` walk seeds (a to f), run on nextStep(s, state)
// straight from the loaded renderer. The walk drives these through a live Electron window and a real CLI; here each
// stage is a snapshot and the renderer's own state, and the rule is asserted as a function of them.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const h = load();
/** @type {(s: Snapshot, state?: object) => any} */
const nextStep = (s, state = {}) => h.call("nextStep", s, { ...idle(), ...state });
/** Nothing under way: no push offered or running, no thread working, nothing drafted. */
const idle = () => ({ pushOffer: false, pushing: false, busy: null, candidates: [], extraDrafts: [], taskItems: [] });

/** @param {Partial<Snapshot["node"]["live"]>} live */
const online = (live = {}) => ({ url: "https://store.example/mcp", agents: null, selling: true, store: "current", live: { state: "online", network: "eip155:84532", price_usd: 0.02, payout: `0x${"a".repeat(40)}`, ...live } });
const memory = (id) => ({ id, title: `Memory ${id}`, project_label: "p", status: "private", updated_at: "2026-10-30", sources: [], arrival: id });
const piece = (id, live, state = "approved") => ({ id, public_id: `pub-${id}`, title: `Piece ${id}`, topic: "t", state, live });
const obsidian = { name: "obsidian", label: "Obsidian", enabled: true, imported: 1, connector: "obsidian" };
const working = (kind) => ({ version: 1, kind, title: kind, state: "working", phase: "Working", updatedAt: new Date().toISOString() });
const done = (kind) => ({ ...working(kind), state: "done", phase: "Finished" });

/** Stage by stage, what the today walk reaches: [name, snapshot, state, expected label (or "drafts" or null), action]. */
const STAGES = [
  ["e: nothing connected and nothing kept", emptySnapshot(), {}, "Connect the AI you talk to most", "Connect"],
  ["e: an app that is off still counts as nothing connected", emptySnapshot({ library: { counts: { private: 0 }, sources: [{ ...obsidian, enabled: false, connector: null }], items: [] } }), {}, "Connect the AI you talk to most", "Connect"],
  ["d: memories, nothing drafted or for sale", emptySnapshot({ library: { counts: { private: 2 }, sources: [], items: [memory(1), memory(2)] } }), {}, "Turn what you know into something to sell", "Start"],
  ["d: a publish thread at work is the step itself, so the Inbox asks nothing", emptySnapshot({ library: { counts: { private: 2 }, sources: [], items: [memory(1), memory(2)] } }), { taskItems: [working("publish")] }, null],
  ["d: once the publish thread finishes with nothing drafted, the step is back", emptySnapshot({ library: { counts: { private: 2 }, sources: [], items: [memory(1), memory(2)] } }), { taskItems: [done("publish")] }, "Turn what you know into something to sell", "Start"],
  ["c: drafts waiting are the step, with no card pointing at them", emptySnapshot({ library: { counts: { private: 2 }, sources: [], items: [memory(1), memory(2)] } }), { candidates: [{ title: "x" }] }, "drafts"],
  ["c: new free parts for a piece on sale count as drafts too", emptySnapshot({ library: { counts: { private: 2 }, sources: [], items: [memory(1), memory(2)] } }), { extraDrafts: [{ extras: {}, piece: {} }] }, "drafts"],
  ["b2: an approved piece with no store, ahead of the draft still waiting", emptySnapshot({ library: { counts: { private: 1 }, sources: [], items: [memory(2)] }, publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, null)] }, pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false } }), { candidates: [{ title: "x" }] }, "1 approved piece isn't on sale yet", "Open your store"],
  ["b2: two approved pieces, plural", emptySnapshot({ publications: { counts: { active: 2, revoked: 0 }, items: [piece(1, null), piece(2, null)] } }), {}, "2 approved pieces aren't on sale yet", "Open your store"],
  ["b2: a store online for the owner's agents only is not open for sale", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, null)] }, node: { ...online(), selling: false } }), {}, "1 approved piece isn't on sale yet", "Open your store"],
  ["b2: while the store opens, the Inbox offers no next step", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, null)] } }), { taskItems: [working("deploy")] }, null],
  ["b2: a deploy turn open in the composer counts the same", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, null)] } }), { busy: "deploy" }, null],
  ["b: an approval the store doesn't hold yet, ahead of the draft still waiting", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, false)] }, pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false }, node: online() }), { candidates: [{ title: "x" }] }, "1 change isn't live yet", "Update store"],
  ["b: a new price counts as a change too", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, false)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false }, node: online() }), {}, "2 changes aren't live yet", "Update store"],
  ["b: with only the price left, the step is that one change", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, true)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false }, node: online() }), {}, "1 change isn't live yet", "Update store"],
  ["b: a piece taken down but still on the store is a change", emptySnapshot({ publications: { counts: { active: 0, revoked: 1 }, items: [piece(1, true, "revoked")] }, pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false }, node: online() }), {}, "1 change isn't live yet", "Update store"],
  ["b: an offered push is the step already, so no card", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, false)] }, node: online() }), { pushOffer: "Updating your store…" }, null],
  ["b: a push under way, the same", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, false)] }, node: online() }), { pushing: true }, null],
  ["a: a store that isn't answering comes first", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, false)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false }, node: online({ state: "unreachable", price_usd: null }) }), { candidates: [{ title: "x" }] }, "Your store isn't responding", "Fix it"],
  ["a: while the repair runs, no step, though the store still isn't answering", emptySnapshot({ node: online({ state: "unreachable" }) }), { taskItems: [working("deploy")] }, null],
  ["a: once the repair ends with the store still silent, Fix it is offered again", emptySnapshot({ node: online({ state: "unreachable" }) }), { taskItems: [{ ...done("deploy"), state: "stopped", phase: "Needs another try" }] }, "Your store isn't responding", "Fix it"],
  ["f: everything live, nothing drafted, an app connected: nothing to ask", emptySnapshot({ library: { counts: { private: 2 }, sources: [obsidian], items: [memory(1), memory(2)] }, publications: { counts: { active: 2, revoked: 0 }, items: [piece(1, true), piece(2, true)] }, pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false }, node: online() }), {}, null],
  ["f: everything live but nothing connected still asks to connect", emptySnapshot({ library: { counts: { private: 2 }, sources: [], items: [memory(1), memory(2)] }, publications: { counts: { active: 2, revoked: 0 }, items: [piece(1, true), piece(2, true)] }, pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false }, node: online() }), {}, "Connect the AI you talk to most", "Connect"],
  ["f: a store on real money, same", emptySnapshot({ library: { counts: { private: 2 }, sources: [obsidian], items: [memory(1), memory(2)] }, publications: { counts: { active: 2, revoked: 0 }, items: [piece(1, true), piece(2, true)] }, pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false }, node: online({ network: "eip155:8453" }) }), {}, null]
];

for (const [name, snapshot, state, label, action] of STAGES) {
  test(name, () => {
    const step = nextStep(snapshot, state);
    if (label === null || label === "drafts") return assert.equal(step, label);
    assert.ok(step && typeof step === "object", `expected a step card, got ${JSON.stringify(step)}`);
    assert.equal(step.label, label);
    assert.equal(step.action, action);
    assert.equal(typeof step.run, "function");
    assert.ok(["store", "update", "sell", "connect"].includes(step.mark), step.mark);
  });
}

test("the update step's detail names what isn't live: approvals, take-downs and the price the store still charges", () => {
  const s = emptySnapshot({ publications: { counts: { active: 2, revoked: 1 }, items: [piece(1, false), piece(2, false), piece(3, true, "revoked")] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false }, node: online() });
  const step = nextStep(s);
  assert.equal(step.label, "4 changes aren't live yet");
  assert.equal(step.detail, "2 approved, not on your store yet · 1 taken down, still on your store · Your store still charges $0.02, not $0.75");
  const priceOnly = nextStep(emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, true)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false }, node: online() }));
  assert.equal(priceOnly.detail, "Your store still charges $0.02, not $0.75");
  assert.doesNotMatch(priceOnly.detail, /approved, not on/);
});

test("a saved price the store cannot be asked about is not a change", () => {
  // The probe says nothing about the price (an older node, or one it could not reach): only pushes count.
  const s = emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, true)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false }, node: online({ price_usd: null }) });
  assert.equal(nextStep(s).label, "Connect the AI you talk to most", "nothing connected is the step left, so no change is waiting");
  s.library.sources = [obsidian];
  assert.equal(nextStep(s), null);
});

test("the stages come in one order: store down, changes, approved but not on sale, drafts, sell, connect", () => {
  // One snapshot that qualifies for every stage at once, then each stage removed in turn.
  const s = emptySnapshot({ library: { counts: { private: 2 }, sources: [], items: [memory(1), memory(2)] }, publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, false)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false }, node: online({ state: "unreachable", price_usd: 0.02 }) });
  const drafts = { candidates: [{ title: "x" }] };
  assert.equal(nextStep(s, drafts).label, "Your store isn't responding");
  s.node.live.state = "online";
  assert.equal(nextStep(s, drafts).label, "2 changes aren't live yet");
  s.node.selling = false;
  s.node.live.price_usd = null; // a price the store still charges is a change whether or not it is open for sale
  assert.equal(nextStep(s, drafts).label, "1 approved piece isn't on sale yet", "a store not open for sale has no pushes to count, and the piece is not on sale");
  s.publications = { counts: { active: 0, revoked: 0 }, items: [] };
  assert.equal(nextStep(s, drafts), "drafts");
  assert.equal(nextStep(s).label, "Turn what you know into something to sell");
  s.library = { counts: { private: 0 }, sources: [], items: [] };
  assert.equal(nextStep(s).label, "Connect the AI you talk to most");
  s.library.sources = [obsidian];
  assert.equal(nextStep(s), null);
});

test("nextStep without a state reads the renderer's own, as render() calls it", () => {
  const s = emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, null)] } });
  assert.equal(h.call("nextStep", s).label, "1 approved piece isn't on sale yet");
  h.set("busy", "deploy");
  assert.equal(h.call("nextStep", s), null, "a deploy turn open in the composer hides the step");
  h.set("busy", null);
  h.set("candidates", [{ title: "x" }]);
  assert.equal(h.call("nextStep", emptySnapshot()), "drafts");
  h.set("candidates", []);
  assert.equal(h.call("nextStep", s).label, "1 approved piece isn't on sale yet");
});

test("the Inbox draws the step as one row, never more than one, with its action as the row's verb", async () => {
  const s = emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, null)] } });
  h.lore.answer("snapshot", s);
  h.boot();
  await h.idle();
  assert.equal(h.text("#title"), "Inbox");
  const steps = h.all("#content .irow.step");
  assert.equal(steps.length, 1);
  assert.match(steps[0].textContent, /1 approved piece isn't on sale yet/);
  assert.equal(steps[0].querySelector("button.verb")?.textContent, "Open your store");
  // Stage b: an update step says what isn't live in its tail.
  h.lore.answer("snapshot", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, false)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false }, node: online() }));
  h.lore.emit({ type: "changed" });
  await h.idle();
  const update = h.all("#content .irow.step");
  assert.equal(update.length, 1);
  assert.match(update[0].textContent, /2 changes aren't live yet · 1 approved, not on your store yet · Your store still charges \$0\.02, not \$0\.75/);
  assert.equal(update[0].querySelector("button.verb")?.textContent, "Update store");
  // Stage f: nothing to ask, so no step row.
  h.lore.answer("snapshot", emptySnapshot({ library: { counts: { private: 2 }, sources: [obsidian], items: [memory(1), memory(2)] }, publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, true)] }, pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false }, node: online() }));
  h.lore.emit({ type: "changed" });
  await h.idle();
  assert.equal(h.all("#content .irow.step").length, 0);
});
