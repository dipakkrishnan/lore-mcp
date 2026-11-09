// APP-268: the Update button and Settings → Updates (APP-126) as a table over every state an AppUpdate can be in, as the
// `settings` and `update` walks assert them through live events.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load } = require("../../support/renderer-harness.cjs");

const h = load();
const update = (state, newer) => ({ version: "0.1.13", state, ...(newer === undefined ? {} : { newer }) });

/** [state, newer, button hidden, button title] */
const BUTTON = [
  ["current", undefined, true, "Move Lore to Applications to update"],
  ["checking", undefined, true, "Move Lore to Applications to update"],
  ["downloading", undefined, true, "Move Lore to Applications to update"],
  ["ready", undefined, false, "Lore restarts with the new version"],
  ["ready", false, false, "Lore restarts with the new version"],
  ["offline", undefined, true, "Move Lore to Applications to update"],
  ["outside", undefined, true, "Move Lore to Applications to update"],
  ["outside", false, true, "Move Lore to Applications to update"],
  ["outside", true, false, "Move Lore to Applications to update"]
];

for (const [state, newer, hidden, title] of BUTTON) {
  test(`updateButton: ${state}${newer === undefined ? "" : ` (newer: ${newer})`} ${hidden ? "shows no button" : "shows Update"}`, () => {
    assert.deepEqual(h.call("updateButton", update(state, newer)), { hidden, title });
  });
}

/** [state, newer, detail, pill, buttons] */
const ROW = [
  ["current", undefined, "Lore keeps itself up to date.", "Up to date", ["Check for updates"]],
  ["checking", undefined, "Lore keeps itself up to date.", "Checking", []],
  ["downloading", undefined, "A new version is downloading. Lore asks before it restarts.", "Downloading", []],
  ["ready", undefined, "A new version is ready.", null, ["Restart to update"]],
  ["offline", undefined, "Lore couldn't check for a new version just now. It will try again later.", null, ["Check again"]],
  ["outside", true, "Move Lore to Applications so it can update itself.", null, ["Move to Applications"]]
];

for (const [state, newer, detail, pill, buttons] of ROW) {
  test(`updateRow: ${state} says "${detail}"`, () => {
    const row = h.call("updateRow", update(state, newer));
    assert.equal(row.querySelector("b")?.textContent, "Lore 0.1.13");
    assert.equal(row.querySelector(".t span")?.textContent, detail);
    assert.equal(row.querySelector(".status-pill")?.textContent ?? null, pill);
    assert.deepEqual([...row.querySelectorAll("button")].map((button) => button.textContent), buttons);
  });
}

test("the row's buttons ask main to check or to install", () => {
  h.lore.reset();
  h.call("updateRow", update("current")).querySelector("button").click();
  h.call("updateRow", update("offline")).querySelector("button").click();
  h.call("updateRow", update("ready")).querySelector("button").click();
  h.call("updateRow", update("outside", true)).querySelector("button").click();
  assert.deepEqual(h.lore.names(), ["checkUpdate", "checkUpdate", "installUpdate", "installUpdate"]);
});

test("an update event drives the button by the Lore name and the Updates row in Settings", async () => {
  h.signIn();
  await h.idle();
  const button = h.document.getElementById("update");
  assert.equal(button.hidden, true, "no update button until one is ready");
  h.lore.emit({ type: "update", update: update("ready") });
  assert.equal(button.hidden, false, "a ready update shows Update by the Lore name");
  assert.equal(button.textContent, "Update");
  assert.ok(button.closest(".ws-row"), "on the workspace row");
  h.call("show", "settings");
  const rowOf = (label) => h.all("#content .row").find((row) => row.querySelector("b")?.textContent === label);
  assert.match(rowOf("Lore 0.1.13")?.textContent ?? "", /Restart to update/, "Settings shows the version and the same restart");
  h.lore.emit({ type: "update", update: update("offline") });
  assert.equal(button.hidden, true, "unable to check says so in Settings only");
  assert.match(rowOf("Lore 0.1.13")?.textContent ?? "", /couldn't check/);
  h.lore.emit({ type: "update", update: update("outside", true) });
  assert.equal(button.hidden, false, "a copy outside Applications offers the move, and Update");
  assert.match(rowOf("Lore 0.1.13")?.textContent ?? "", /Move to Applications/);
  h.lore.reset();
  button.click();
  assert.deepEqual(h.lore.names(), ["installUpdate"], "Update by the Lore name installs");
  h.lore.emit({ type: "update", update: update("current") });
  assert.equal(button.hidden, true);
  assert.match(rowOf("Lore 0.1.13")?.textContent ?? "", /Up to date/);
});

test("Settings has no Updates section before main has said where this copy stands", async () => {
  const w = load({ answers: { update: () => new Promise(() => {}) } });
  w.signIn();
  await w.idle();
  w.call("show", "settings");
  assert.ok(!w.all("#content h2").some((node) => node.textContent === "Updates"));
});
