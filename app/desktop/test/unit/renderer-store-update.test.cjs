// APP-270: what the retired `update` walk asserted of a newer store from Lore (APP-231), now on the loaded renderer with
// the CLI's answers faked. The snapshot's node.store says how the store online stands against the one this Lore ships
// (outdated, current or unknown); the walk got there through a stand-in deploy and the CLI's own records. Here: a newer
// store is never a step on the Inbox; Settings offers it beside the store's address, in plain words, with a quiet
// Update that asks main for the newer store; nothing is offered once the store is current, or for a store this Mac has
// no record of putting online; and a store online only for its agents is offered it too. What Update then puts out
// (the changes sheet's yes or no, and the deploy's network, wallet or --inbox-only) is test/unit/store.test.cjs's "Update
// store puts out the newer store Lore ships…"; how the CLI tells outdated from current and unknown is
// tests/test_deploy.py's test_a_deploy_that_went_out_records_the_store_this_lore_ships. Layout stays with the walks:
// views.json names the kept walks that scan Settings and the changes sheet.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const URL_ = "https://store.example/mcp";
/** @param {"outdated" | "current" | "unknown"} store @param {boolean} [selling] @returns {Snapshot} */
const withStore = (store, selling = true) => emptySnapshot({
  node: { url: URL_, agents: null, selling, store, live: { state: "online", network: selling ? "eip155:84532" : null, payout: selling ? `0x${"a".repeat(40)}` : null, price_usd: null } }
});

/** @param {Snapshot} snapshot */
async function signedIn(snapshot) {
  const h = load();
  h.lore.answer("snapshot", snapshot);
  h.boot();
  await h.idle();
  return h;
}
const address = (/** @type {ReturnType<typeof load>} */ h) => h.all("#content .row").find((row) => row.querySelector(".t b")?.textContent === "Address");
const updateButton = (/** @type {ReturnType<typeof load>} */ h) => [...(address(h)?.querySelectorAll("button") ?? [])].find((button) => button.textContent === "Update");

test("a newer store from Lore is never a step on the Inbox", async () => {
  const h = await signedIn(withStore("outdated"));
  assert.equal(h.text("#title"), "Inbox");
  assert.doesNotMatch(h.text("#content"), /newer store|store has an update|update from Lore/i);
  assert.ok(!h.all("#content .irow.step").some((step) => /update/i.test(step.textContent ?? "")), "no next step offers it");
});

test("Settings says a newer store is ready beside the store's address, with a quiet Update, never naming code, versions or deploys", async () => {
  const h = await signedIn(withStore("outdated"));
  h.call("show", "settings");
  await h.idle();
  const row = address(h);
  assert.ok(row, "Settings has the store's Address row");
  assert.match(row.textContent ?? "", /Your store has an update\./);
  const update = updateButton(h);
  assert.ok(update, "an Update beside it");
  assert.ok(update.classList.contains("quiet"), "a quiet one");
  assert.doesNotMatch(row.textContent ?? "", /worker|code|version|deploy/i);
});

test("Update asks main for the newer store; once the store is the one Lore ships, nothing more is offered", async () => {
  const h = await signedIn(withStore("outdated"));
  h.call("show", "settings");
  await h.idle();
  h.lore.answer("push", true);
  h.lore.answer("snapshot", withStore("current"));
  h.lore.reset();
  /** @type {HTMLButtonElement} */ (updateButton(h)).click();
  await h.idle();
  assert.deepEqual(h.lore.callsTo("push").map((call) => call.args), [[true]], "the push carries the newer store, which asks before anything goes out (store.test.cjs)");
  h.lore.emit({ type: "changed" });
  await h.idle();
  assert.equal(h.text("#title"), "Settings");
  assert.doesNotMatch(address(h)?.textContent ?? "", /has an update/);
  assert.equal(updateButton(h), undefined);
});

test("a store online only for its agents is offered its update too", async () => {
  const h = await signedIn(withStore("outdated", false));
  h.call("show", "settings");
  await h.idle();
  assert.match(address(h)?.textContent ?? "", /Your store has an update\./);
  assert.ok(updateButton(h));
});

test("a store this Mac has no record of putting online, or one already current, is never offered an update", async () => {
  for (const store of /** @type {const} */ (["unknown", "current"])) {
    const h = await signedIn(withStore(store));
    h.call("show", "settings");
    await h.idle();
    assert.ok(address(h), store);
    assert.doesNotMatch(address(h)?.textContent ?? "", /has an update|newer store/i, store);
    assert.equal(updateButton(h), undefined, store);
    h.call("show", "inbox");
    await h.idle();
    assert.doesNotMatch(h.text("#content"), /newer store|store has an update|update from Lore/i, store);
  }
});
