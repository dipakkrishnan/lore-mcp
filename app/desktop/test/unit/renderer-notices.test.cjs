// APP-268: the Inbox notice state machine (APP-211; the Inbox was Today until APP-283), as the `fresh` walk drove it until APP-269 retired it,
// with a busy CLI: a notice told once a sign-in, shown only on the Inbox, remembered as said only once seen, its failed
// write tried again on the next load, and
// dropped whole by a sign-out. The pure rules (withNotice, shownNotices) are tabled; the rest is driven through the
// loaded renderer with the fake window.lore failing writes on cue.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const plain = (text) => ({ text, attention: false });
const alert = (text) => ({ text, attention: true });
const once = (key, text) => ({ text, attention: false, key });

/** [name, notices so far, the one told, what is left] */
const WITH_NOTICE = [
  ["a first notice is kept", [], plain("a"), ["a"]],
  ["a newer success replaces an older one", [plain("a")], plain("b"), ["b"]],
  ["a success leaves an alert and a notice told once alone", [alert("x"), once("k", "k")], plain("b"), ["x", "k", "b"]],
  ["an alert replaces nothing", [plain("a"), alert("x")], alert("y"), ["a", "x", "y"]],
  ["plain notices stay at most three, the oldest leaving first", [alert("1"), alert("2"), alert("3")], alert("4"), ["2", "3", "4"]],
  ["a notice told once does not count toward the three", [once("k", "k"), alert("1"), alert("2"), alert("3")], alert("4"), ["k", "2", "3", "4"]],
  ["a success after three alerts makes four: the oldest alert leaves", [alert("1"), alert("2"), alert("3")], plain("b"), ["2", "3", "b"]]
];

const h = load();

for (const [name, items, notice, left] of WITH_NOTICE) {
  test(`withNotice: ${name}`, () => {
    assert.deepEqual(h.call("withNotice", items, notice).map((item) => item.text), left);
  });
}

test("shownNotices: a plain notice shows anywhere, one told once only on the Inbox", () => {
  const items = [plain("a"), once("k", "k"), alert("x")];
  assert.deepEqual(h.call("shownNotices", items, true).map((item) => item.text), ["a", "k", "x"]);
  assert.deepEqual(h.call("shownNotices", items, false).map((item) => item.text), ["a", "x"]);
});

/** A snapshot of an owner who signed in before the welcome screen said what usage events are sent. */
const unsaid = () => emptySnapshot({ setup: { sources_configured: false, blueprint_configured: false, profile_configured: false, telemetry_enabled: true, telemetry_noticed: false, automations_noticed: false, schedule: null } });
const USAGE = "anonymous usage events";
const noticesSaying = (harness, text) => harness.all("#status .notice").filter((node) => node.textContent.includes(text));
const noticedWrites = (harness) => harness.lore.callsTo("usage").filter((call) => call.args[0] === "noticed").length;

test("a notice waits for the Inbox, is remembered only once seen, and a failed write is tried again on the next load", async () => {
  const w = load();
  w.lore.answer("snapshot", unsaid());
  w.lore.failNext("usage", "database is locked");
  // Loading on another page shows no notice there, and nothing is remembered as said before it's seen.
  w.call("show", "connectors");
  w.signIn();
  await w.idle();
  assert.equal(w.text("#title"), "Connectors");
  assert.equal(w.all("#status .notice").length, 0, "no notice on Connectors");
  assert.equal(noticedWrites(w), 0, "nothing remembered before it's seen");
  assert.equal(w.get("told").has("usage"), true, "but the notice is told, waiting for the Inbox");
  // The first visit to the Inbox shows it, and tries to remember it only then; that first write fails.
  w.call("show", "inbox");
  await w.idle();
  assert.equal(noticesSaying(w, USAGE).length, 1);
  assert.equal(noticedWrites(w), 1, "one write, which failed");
  assert.notEqual(w.get("told").get("usage"), null, "a failed write stays to be tried again");
  assert.equal(w.get("told").get("usage").pending, false);
  // The next snapshot tries again, with the notice still shown once.
  w.lore.emit({ type: "changed" });
  await w.idle();
  assert.equal(noticedWrites(w), 2, "tried again");
  assert.equal(w.get("told").get("usage"), null, "remembered");
  assert.deepEqual(w.lore.callsTo("usage").map((call) => call.args[0]).slice(1), ["noticed", "app.installed", "app.opened"], "only then counts Lore as opened");
  assert.equal(noticesSaying(w, USAGE).length, 1, "shown once throughout");
  // Notices belong to the Inbox: the other pages open clean, and the Inbox has it back until dismissed.
  for (const page of ["inventory", "connectors", "bids"]) {
    w.call("show", page);
    assert.equal(w.all("#status .notice").length, 0, `${page} carries no notice`);
  }
  w.call("show", "inbox");
  assert.equal(noticesSaying(w, USAGE).length, 1);
  // Later snapshots leave it alone.
  w.lore.emit({ type: "changed" });
  await w.idle();
  assert.equal(noticedWrites(w), 2);
  assert.equal(noticesSaying(w, USAGE).length, 1);
});

test("nothing is said about reading connected apps while none is connected; once one is, the Inbox says it once, with where to change it", async () => {
  const w = load();
  const s = unsaid();
  s.setup.telemetry_noticed = true;
  w.lore.answer("snapshot", s);
  w.lore.answer("routines", [
    { id: "synthesis", kind: "read", name: "Read connected apps", about: "", built_in: true, cadence: "daily", hour: 18, last_run: null, result: "", next_run: "", due: false },
    { id: "checkin", kind: "checkin", name: "Evening check-in", about: "", built_in: true, cadence: "daily", hour: 21, last_run: null, result: "", next_run: "", due: false }
  ]);
  w.signIn();
  await w.idle();
  assert.equal(w.all("#status .notice").length, 0, "nothing connected: nothing to say");
  s.library.sources = [{ name: "obsidian", label: "Obsidian", enabled: true, imported: 1, connector: "obsidian" }];
  w.lore.emit({ type: "changed" });
  await w.idle();
  const told = noticesSaying(w, "Change this in Settings");
  assert.equal(told.length, 1);
  assert.equal(told[0].querySelector("span").textContent, "Lore reads your connected apps every day at 6 PM and checks in at 9 PM when something's worth asking. Change this in Settings.");
  assert.equal(told[0].querySelector("button.quiet")?.textContent, "Settings");
  assert.equal(w.lore.callsTo("noticedRoutines").length, 1, "remembered as said once seen");
  told[0].querySelector("button.quiet").click();
  assert.equal(w.text("#title"), "Settings", "its action opens Settings, where automations now live");
  assert.equal(noticesSaying(w, "Change this in Settings").length, 0, "and takes the notice with it");
});

test("a paused check-in leaves the notice to the reading alone", async () => {
  const w = load();
  const s = unsaid();
  s.setup.telemetry_noticed = true;
  s.library.sources = [{ name: "obsidian", label: "Obsidian", enabled: true, imported: 1, connector: "obsidian" }];
  w.lore.answer("snapshot", s);
  w.lore.answer("routines", [
    { id: "synthesis", kind: "read", name: "Read connected apps", about: "", cadence: "weekly", hour: 21, day: 6, last_run: null, result: "", next_run: "", due: false },
    { id: "checkin", kind: "checkin", name: "Evening check-in", about: "", cadence: "daily", hour: 21, paused: true, last_run: null, result: "", next_run: "", due: false }
  ]);
  w.signIn();
  await w.idle();
  assert.equal(noticesSaying(w, "Change this in Settings")[0]?.querySelector("span").textContent, "Lore reads your connected apps every Sunday at 9 PM. Change this in Settings.");
});

test("dismissed while its write is out, and the write fails: it stays dismissed, and the next load remembers it without showing it again", async () => {
  const w = load();
  const s = unsaid();
  s.setup.telemetry_noticed = true;
  s.library.sources = [{ name: "obsidian", label: "Obsidian", enabled: true, imported: 1, connector: "obsidian" }];
  w.lore.answer("snapshot", s);
  w.lore.answer("routines", [{ id: "synthesis", kind: "read", name: "Read connected apps", about: "", cadence: "daily", hour: 18, last_run: null, result: "", next_run: "", due: false }]);
  let release = () => {};
  w.lore.answer("noticedRoutines", () => new Promise((_, reject) => { release = () => reject(new w.window.Error("database is locked")); }));
  w.signIn();
  await w.idle();
  assert.equal(noticesSaying(w, "Change this in Settings").length, 1);
  assert.equal(w.lore.callsTo("noticedRoutines").length, 1, "the write is out");
  noticesSaying(w, "Change this in Settings")[0].querySelector(".dismiss").click();
  assert.equal(noticesSaying(w, "Change this in Settings").length, 0, "dismissed at once");
  release();
  await w.idle();
  assert.equal(w.lore.callsTo("noticedRoutines").length, 1, "the failed write is not retried on its own");
  assert.equal(noticesSaying(w, "Change this in Settings").length, 0, "stays dismissed");
  w.lore.answer("noticedRoutines", undefined);
  w.lore.emit({ type: "changed" });
  await w.idle();
  assert.equal(w.lore.callsTo("noticedRoutines").length, 2, "the next load tries the write again");
  assert.equal(w.get("told").get("automations"), null, "remembered");
  assert.equal(noticesSaying(w, "Change this in Settings").length, 0, "without showing it again");
  w.lore.emit({ type: "changed" });
  await w.idle();
  assert.equal(w.lore.callsTo("noticedRoutines").length, 2, "later loads leave it alone");
});

test("signing out drops every notice told this sign-in, and a write queued behind a slow one never goes out", async () => {
  const w = load();
  const s = unsaid();
  s.library.sources = [{ name: "obsidian", label: "Obsidian", enabled: true, imported: 1, connector: "obsidian" }];
  w.lore.answer("snapshot", s);
  w.lore.answer("routines", [{ id: "synthesis", kind: "read", name: "Read connected apps", about: "", cadence: "daily", hour: 18, last_run: null, result: "", next_run: "", due: false }]);
  // The automations write hangs; the usage write queues behind it.
  w.lore.answer("noticedRoutines", () => new Promise(() => {}));
  w.signIn();
  await w.idle();
  assert.equal(noticesSaying(w, "Change this in Settings").length, 1);
  assert.equal(noticesSaying(w, USAGE).length, 1, "the Inbox says both");
  assert.equal(w.lore.callsTo("noticedRoutines").length, 1);
  assert.equal(noticedWrites(w), 0, "the usage write waits its turn");
  w.set("auth", { credentials: [] });
  w.call("enter");
  await w.idle();
  assert.equal(w.document.body.dataset.state, "welcome");
  assert.equal(w.get("told").size, 0, "nothing is left told");
  assert.equal(w.all("#status .notice").length, 0);
  assert.deepEqual(w.lore.callsTo("usage").map((call) => call.args[0]), ["noticed", "app.installed"], "only the welcome screen's own notice is written, never the queued one");
});

test("a plain notice shows wherever the owner is, with its × to dismiss it; an attention notice is an alert", () => {
  const w = load();
  w.call("show", "connectors");
  w.call("tell", "Store updated.");
  w.call("tell", "Store updated again.");
  w.call("tell", "Lore couldn't reach your store.", true, { label: "Try again", run: () => {} });
  const shown = w.all("#status .notice");
  assert.deepEqual(shown.map((node) => node.querySelector("span").textContent), ["Store updated again.", "Lore couldn't reach your store."], "a newer success replaces the older one");
  assert.deepEqual(shown.map((node) => node.getAttribute("role")), ["status", "alert"]);
  assert.equal(shown[1].querySelector("button.quiet")?.textContent, "Try again");
  shown[0].querySelector(".dismiss").click();
  assert.deepEqual(w.all("#status .notice").map((node) => node.querySelector("span").textContent), ["Lore couldn't reach your store."]);
});
