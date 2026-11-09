// APP-269: what the `fresh` walk checked on an empty Lore, now on the loaded renderer: the welcome screen's usage line
// and the write that remembers it, each empty view naming the next action with a real button that takes it, Lore's own
// automations listed on in Settings, and a sign-in after a sign-out starting clean. The notice state machine the walk
// also drove (told once, shown only on the Inbox, remembered once seen, failed writes retried) is
// renderer-notices.test.cjs; that Lore's routines are on from the start is tests/test_automation.py's OnByDefaultTest,
// and that the install is counted once in the local log is tests/test_usage.py. What these views look like is the walks':
// views.json names the kept walk that scans each.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const signedOut = { credentials: [] };
/** @param {Partial<Snapshot["setup"]>} setup */
const withSetup = (setup) => emptySnapshot({ setup: { ...emptySnapshot().setup, ...setup } });

test("the welcome screen says usage events are sent, with what was sent one click away", async () => {
  const h = load();
  h.lore.answer("agentStatus", signedOut);
  h.boot();
  await h.idle();
  const see = /** @type {HTMLButtonElement} */ (h.document.getElementById("welcome-usage"));
  assert.equal(see.textContent, "See what's sent");
  assert.match(see.parentElement?.textContent ?? "", /^Lore sends anonymous usage events, never your writing\./);
  see.click();
  assert.equal(h.lore.callsTo("usageLog").length, 1, "the button opens what was sent");
});

test("a failed write remembering the welcome screen's notice sends nothing else; signing out while Lore loads remembers only that notice, and counts the install", async () => {
  const h = load();
  h.lore.answer("agentStatus", signedOut);
  h.lore.failNext("usage", "database is locked");
  h.boot();
  await h.idle();
  assert.deepEqual(h.lore.callsTo("usage").map((call) => call.args[0]), ["noticed"], "the first write fails and nothing else is sent");
  h.lore.answer("snapshot", withSetup({ telemetry_noticed: false, automations_noticed: false }));
  h.signIn();
  h.set("auth", signedOut);
  h.call("enter");
  await h.idle();
  assert.deepEqual(h.lore.callsTo("usage").map((call) => call.args[0]), ["noticed", "noticed", "app.installed"]);
  assert.equal(h.document.body.dataset.state, "welcome");
  assert.equal(h.all("#status .notice").length, 0);
});

test("opened again with everything said, the Inbox says nothing more", async () => {
  const h = load();
  h.lore.answer("snapshot", withSetup({ telemetry_noticed: true, automations_noticed: true, sources_configured: true }));
  h.boot();
  await h.idle();
  assert.doesNotMatch(h.text("#status"), /Change this in Settings|anonymous usage events/);
});

test("signing in again after a sign-out is a fresh sign-in: the welcome screen said it, so the Inbox doesn't, and Lore counts as opened", async () => {
  const h = load();
  h.lore.answer("snapshot", withSetup({ telemetry_noticed: false }));
  h.boot();
  await h.idle();
  assert.equal(h.all("#status .notice").filter((node) => node.textContent?.includes("anonymous usage events")).length, 1, "first sign-in: the Inbox says it");
  h.set("auth", signedOut);
  h.call("enter");
  await h.idle();
  h.lore.reset();
  h.lore.answer("snapshot", withSetup({ telemetry_noticed: true }));
  h.signIn();
  await h.idle();
  assert.doesNotMatch(h.text("#status"), /anonymous usage events/);
  assert.deepEqual(h.lore.callsTo("usage").map((call) => call.args[0]), ["app.opened"]);
});

test("an empty Inventory says what to do and offers to do it; Add your first memory lands on the Inbox with the composer focused", async () => {
  const h = load();
  h.boot();
  await h.idle();
  h.call("show", "memories");
  const empty = h.document.querySelector("#content .empty");
  assert.match(empty?.textContent ?? "", /^Nothing kept yet\. Say what you learned, or connect an agent, and Lore will keep it\./);
  const add = /** @type {HTMLButtonElement} */ (empty?.querySelector("button"));
  assert.equal(add.textContent, "Add your first memory");
  add.click();
  await h.idle();
  assert.notEqual(h.text("#title"), "Inventory");
  assert.equal(h.document.activeElement, h.document.getElementById("capture-input"));
});

test("with no store, Settings offers to open one, and Inventory carries no store card, header button or boxed group", async () => {
  const h = load();
  h.boot();
  await h.idle();
  h.call("show", "settings");
  const address = h.all("#content .row").find((row) => row.querySelector(".t b")?.textContent === "Address");
  assert.equal(address?.querySelector("button")?.textContent, "Open your store");
  h.call("show", "store");
  assert.equal(h.document.querySelector("#content .card, #sell-writing, #add-memory, .inv-group, .shelf"), null);
});

test("nothing on sale is one sentence and a way to what's private, with no Sales group, and every empty-state action a real button", async () => {
  const h = load();
  h.boot();
  await h.idle();
  h.call("show", "store");
  const forSale = h.all("#content .empty").map((node) => node.textContent).join("|");
  assert.match(forSale, /Nothing on sale yet\./);
  assert.ok(!h.all("#content .igroup").some((group) => group.textContent?.startsWith("Sales")), "no Sales group");
  const buttons = /** @type {HTMLButtonElement[]} */ (h.all("#content .empty button"));
  assert.ok(buttons.length > 0 && buttons.every((button) => button.tagName === "BUTTON" && button.tabIndex >= 0), "reachable by keyboard");
  const privately = buttons.find((button) => button.textContent === "See what's private");
  assert.ok(privately);
  privately.click();
  await h.idle();
  assert.match(h.document.querySelector(".ptab[aria-selected=true]")?.textContent ?? "", /^Private/);
});

// The `quiet` walk's Inbox: a day the check-in found nothing worth asking about leaves no check-in waiting, so the Inbox
// lists none. That nothing is posted, badged or notified is test/unit/ipc.test.cjs (checkedIn) and
// test/component/agent.test.cjs (a check-in stays silent).
test("a quiet day puts nothing in the Inbox; a check-in waiting is one row with one verb", async () => {
  const h = load();
  h.lore.answer("checkIn", null);
  h.boot();
  await h.idle();
  assert.equal(h.all("#content .irow.checkin").length, 0);
  assert.doesNotMatch(h.text("#content"), /Five minutes|Check-in/);
  h.lore.answer("checkIn", { questions: [{ question: "What made you hold firm?", memory: 1, title: "Pushed back on the Acme pricing call" }], why: "w", at: new Date().toISOString(), state: "waiting" });
  h.lore.emit({ type: "changed" });
  await h.idle();
  const rows = h.all("#content .irow.checkin");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector(".say")?.textContent, "Check-in: 1 question about today");
  assert.equal(rows[0].querySelector(".verb")?.textContent, "Answer");
});

test("Settings lists every one of Lore's own automations, each on", async () => {
  const h = load();
  h.lore.answer("routines", [
    { id: "synthesis", kind: "read", name: "Read connected apps", about: "", built_in: true, cadence: "daily", hour: 9, paused: false, last_run: null, result: "", next_run: "", due: false },
    { id: "checkin", kind: "checkin", name: "Evening check-in", about: "", built_in: true, cadence: "weekdays", hour: 18, paused: false, last_run: null, result: "", next_run: "", due: false },
    { id: "collect", kind: "ask", name: "Suggest collections", about: "", built_in: true, cadence: "weekly", day: 6, hour: 10, paused: false, last_run: null, result: "", next_run: "", due: false }
  ]);
  h.boot();
  await h.idle();
  h.call("show", "automations");
  await h.idle();
  assert.equal(h.text("#title"), "Settings");
  assert.equal(h.all("#automations .switch").map((node) => `${node.getAttribute("aria-label")}=${node.getAttribute("aria-checked")}`).join("|"), "Pause Read connected apps=true|Pause Evening check-in=true|Pause Suggest collections=true");
  assert.equal(h.all("#status .notice").length, 0, "with no notice about them while nothing is connected");
});
