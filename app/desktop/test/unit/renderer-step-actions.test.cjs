// APP-269: what the `today` walk clicked through, stage by stage, now asserted on the loaded renderer. The walk seeded
// each stage through the CLI and clicked the Inbox's one next step in a live window; renderer-next-step.test.cjs tables
// which step each stage shows, and this file presses it: what the click opens, the one prompt it sends (or the push it
// makes instead), and what the Inbox lists while that work runs. How it works, the Inbox's way into the FAQ for an owner
// with nothing kept, is here too. Layout is still the walks': the Inbox's rows are scanned by connectors, settings,
// agents and the other walks views.json lists under `today`.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

/** @param {Partial<Snapshot["node"]["live"]>} live */
const online = (live = {}) => ({ url: "https://store.example/mcp", agents: null, selling: true, store: "current", live: { state: "online", network: "eip155:84532", price_usd: 0.02, payout: `0x${"a".repeat(40)}`, ...live } });
const memory = (/** @type {number} */ id) => ({ id, title: `Memory ${id}`, project_label: "p", status: "private", updated_at: "2026-10-30", sources: [], arrival: id });
const piece = (/** @type {number} */ id, /** @type {boolean | null} */ live) => ({ id, public_id: `pub-${id}`, title: `Piece ${id}`, topic: "t", state: "approved", live });
const kept = () => ({ counts: { private: 2 }, sources: [], items: [memory(1), memory(2)] });
const working = (/** @type {string} */ kind, title = kind) => ({ version: 1, kind, title, state: "working", phase: "Working", updatedAt: new Date().toISOString() });

/** Signed in on the Inbox with `s`, nothing else under way. @param {Snapshot} s @param {Record<string, unknown>} [answers] */
async function inbox(s, answers = {}) {
  const h = load();
  h.lore.answer("snapshot", s);
  for (const [name, value] of Object.entries(answers)) h.lore.answer(name, value);
  h.boot();
  await h.idle();
  assert.equal(h.text("#title"), "Inbox");
  return h;
}
const steps = (/** @type {ReturnType<typeof load>} */ h) => h.all("#content .irow.step");
/** Click the one step's verb and let what it starts settle. @param {ReturnType<typeof load>} h */
async function press(h) {
  const found = steps(h);
  assert.equal(found.length, 1, "one next step");
  /** @type {HTMLButtonElement} */ (found[0].querySelector(".verb")).click();
  await h.idle();
}
const prompts = (/** @type {ReturnType<typeof load>} */ h) => h.lore.callsTo("prompt").map((call) => /** @type {{text: string, task: string}} */ (call.args[0])).map(({ text, task }) => ({ text, task }));

test("How it works is offered while nothing is kept, opens the FAQ, and once closed stays closed", async () => {
  const h = await inbox(emptySnapshot());
  const help = () => h.document.querySelector("#content .irow.help");
  assert.ok(help(), "offered while nothing is kept");
  assert.match(help()?.textContent ?? "", /New to Lore\?.*See how it works/);
  /** @type {HTMLButtonElement} */ (help()?.querySelector(".verb")).click();
  assert.equal(h.text("#title"), "FAQ", "which opens the FAQ");
  h.call("show", "inbox");
  /** @type {HTMLButtonElement} */ (help()?.querySelector(".done")).click();
  assert.equal(help(), null, "closed");
  h.call("show", "memories");
  h.call("show", "inbox");
  assert.equal(help(), null, "and stays closed");
  assert.equal(h.window.localStorage.getItem("lore.how-it-works.closed"), "1", "kept for the next launch");
});

test("an owner with memories is not offered How it works", async () => {
  const h = await inbox(emptySnapshot({ library: kept() }));
  assert.equal(h.document.querySelector("#content .irow.help"), null);
});

test("e: Connect opens Connectors with the Connect an agent sheet, and names no coding agent", async () => {
  const h = await inbox(emptySnapshot());
  assert.doesNotMatch(h.text("#content"), /Claude Code|Codex/);
  assert.equal(h.document.querySelector("#content .tiles"), null, "no grid of apps on the Inbox");
  await press(h);
  assert.equal(h.text("#title"), "Connectors");
  assert.equal(h.document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label"), "Connect an agent");
  assert.deepEqual(prompts(h), [], "and asks the agent nothing");
});

test("d: Start opens the publish thread with one prompt; while it drafts the thread is its own row and no step asks again", async () => {
  const h = await inbox(emptySnapshot({ library: kept() }));
  await press(h);
  assert.equal(h.text("#title"), "Publish from your Lore");
  assert.deepEqual(prompts(h), [{ text: "Help me publish something from my Lore.", task: "publish" }]);
  h.lore.answer("tasks", [working("publish", "Publish from your Lore")]);
  /** @type {HTMLButtonElement} */ (h.document.getElementById("task-back")).click();
  h.lore.emit({ type: "changed" });
  await h.idle();
  assert.equal(steps(h).length, 0, "no step while it drafts");
  assert.equal(h.all("#content .irow.task").length, 1, "the thread is its own row");
});

test("c: each draft is a row with one verb, and Review opens the drafts where they are approved", async () => {
  const h = await inbox(emptySnapshot({ library: kept() }), { candidates: [{ title: "Hire management before rapid growth", teaser: "t", content: "c", kind: "claim", topic: "team scaling", provenance: [1] }, { title: "Price the first tier low", teaser: "t", content: "c", kind: "claim", topic: "pricing", provenance: [2] }] });
  const drafts = h.all("#content .irow.draft");
  assert.equal(drafts.length, 2);
  assert.equal(steps(h).length, 0, "no step pointing at them");
  assert.match(h.text("#content"), /Draft ready: “Hire management before rapid growth”Review/);
  assert.equal(h.document.querySelector("#content .strip"), null);
  /** @type {HTMLButtonElement} */ (drafts[0].querySelector(".verb")).click();
  await h.idle();
  assert.equal(h.text("#title"), "Drafts");
  assert.match(h.text("#content"), /Approve what to sell/);
});

test("b2: Open your store opens the store's thread with Lore's own first line, and nothing else is offered while it opens", async () => {
  const h = await inbox(emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, null)] } }), { candidates: [{ title: "Still waiting", teaser: "t", content: "c", kind: "claim", topic: "t", provenance: [2] }] });
  assert.match(steps(h)[0]?.textContent ?? "", /1 approved piece isn't on sale yet.*Open your store/, "ahead of the draft still waiting");
  await press(h);
  assert.equal(h.text("#title"), "Open your store");
  assert.deepEqual(prompts(h), [{ text: "Help me open my store.", task: "deploy" }]);
  h.lore.answer("tasks", [working("deploy", "Open your store")]);
  /** @type {HTMLButtonElement} */ (h.document.getElementById("task-back")).click();
  h.lore.emit({ type: "changed" });
  await h.idle();
  assert.equal(steps(h).length, 0);
  assert.equal(h.all("#content .irow.draft").length, 1, "the draft is still listed");
  assert.doesNotMatch(h.text("#content"), /Connect the AI you talk to most/);
});

test("b: Update store pushes first while a piece isn't on the store and asks the agent nothing; with only the price left it redeploys in the store's thread", async () => {
  const h = await inbox(emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, false)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false, free_copies: 0 }, node: online() }));
  assert.match(steps(h)[0]?.textContent ?? "", /2 changes aren't live yet/);
  await press(h);
  assert.equal(h.lore.callsTo("push").length, 1, "one push");
  assert.deepEqual(prompts(h), [], "and no prompt");
  h.lore.answer("snapshot", emptySnapshot({ publications: { counts: { active: 1, revoked: 0 }, items: [piece(1, true)] }, pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false, free_copies: 0 }, node: online() }));
  h.lore.emit({ type: "changed" });
  await h.idle();
  assert.match(steps(h)[0]?.textContent ?? "", /1 change isn't live yet · Your store still charges \$0\.02, not \$0\.75/);
  await press(h);
  assert.equal(h.text("#title"), "Open your store");
  assert.equal(prompts(h).length, 1);
  assert.equal(prompts(h)[0].task, "deploy");
  assert.match(prompts(h)[0].text, /Redeploy my store/);
  assert.equal(h.lore.callsTo("push").length, 1, "no second push");
});

test("a: Fix it opens the store's thread with one prompt; the repair is its own row, which reopens the thread and sends nothing, as does a second Fix it", async () => {
  const s = emptySnapshot({ node: online({ state: "unreachable", price_usd: null }) });
  const h = await inbox(s);
  assert.match(steps(h)[0]?.textContent ?? "", /Your store isn't responding.*Fix it/);
  const fix = /** @type {HTMLButtonElement} */ (steps(h)[0].querySelector(".verb"));
  await press(h);
  assert.equal(h.text("#title"), "Open your store");
  assert.equal(prompts(h).length, 1);
  assert.equal(prompts(h)[0].task, "deploy");
  assert.match(prompts(h)[0].text, /isn't responding/);
  h.lore.answer("tasks", [working("deploy", "Open your store")]);
  /** @type {HTMLButtonElement} */ (h.document.getElementById("task-back")).click();
  h.lore.emit({ type: "changed" });
  await h.idle();
  assert.equal(steps(h).length, 0, "no step while the repair runs");
  assert.match(h.text("#account-line"), /offline/, "though the store still isn't answering");
  const repair = h.document.querySelector("#content .irow.task");
  assert.match(repair?.textContent ?? "", /^Open your store · Working/);
  /** @type {HTMLButtonElement} */ (repair?.querySelector(".verb")).click();
  await h.idle();
  assert.equal(h.text("#title"), "Open your store", "the row opens back into its thread");
  assert.equal(prompts(h).length, 1, "sending nothing");
  /** @type {HTMLButtonElement} */ (h.document.getElementById("task-back")).click();
  await h.idle();
  fix.click();
  await h.idle();
  assert.equal(h.text("#title"), "Open your store", "a second Fix it goes back into the repair under way");
  assert.equal(prompts(h).length, 1, "and sends nothing more");
});

test("a repair that fails while the owner is on the Inbox brings Fix it back on its own", async () => {
  const h = await inbox(emptySnapshot({ node: online({ state: "unreachable", price_usd: null }) }));
  h.lore.answer("prompt", new Error("the model stopped answering"));
  await press(h);
  /** @type {HTMLButtonElement} */ (h.document.getElementById("task-back")).click();
  h.lore.answer("tasks", [{ ...working("deploy", "Open your store"), state: "stopped", phase: "Needs another try" }]);
  h.lore.emit({ type: "changed" });
  await h.idle();
  assert.match(steps(h)[0]?.textContent ?? "", /Your store isn't responding/);
});

test("f: with everything live and an app connected, the Inbox shows no step and no How it works", async () => {
  const h = await inbox(emptySnapshot({ library: { counts: { private: 2 }, sources: [{ name: "obsidian", label: "Obsidian", enabled: true, imported: 1, connector: "obsidian" }], items: [memory(1), memory(2)] }, publications: { counts: { active: 2, revoked: 0 }, items: [piece(1, true), piece(2, true)] }, pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false, free_copies: 0 }, node: online() }));
  assert.equal(steps(h).length, 0);
  assert.doesNotMatch(h.text("#content"), /Connect the AI you talk to most/);
});
