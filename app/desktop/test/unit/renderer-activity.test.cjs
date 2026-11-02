// APP-268: Settings' Activity rows (APP-007, APP-214) as a table over the job log, run on activityRuns() and
// activityRow() from the loaded renderer: what the `jobs` and `sales` walks assert of the section's text.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const h = load();
const NOW = new Date("2026-10-30T12:00:00").getTime();
/** @param {Partial<JobItem>} over */
const job = (over) => ({ id: 1, kind: "capture", status: "succeeded", title: "", summary: "", count: null, cost_usd: null, started_at: "2026-10-30T09:00:00", finished_at: "2026-10-30T09:01:00", ...over });
const when = (iso) => h.call("when", iso);

test("the same run again and again is one row with a count; a change in state, title or summary starts another", () => {
  const push = (status, count) => job({ kind: "push", status, count, summary: "Store updated" });
  const runs = h.call("activityRuns", [push("succeeded", 13), push("succeeded", 13), push("succeeded", 13), push("succeeded", 13), push("failed", null), job({ kind: "capture", summary: "Saved what you approved" }), job({ kind: "capture", summary: "Saved what you approved" }), job({ kind: "capture", summary: "Saved nothing" })]);
  assert.deepEqual(runs.map(({ item, summary, times }) => [item.kind, item.status, summary, times]), [
    ["push", "succeeded", "13 publications on your store", 4],
    ["push", "failed", "Store updated", 1],
    ["capture", "succeeded", "Saved what you approved", 2],
    ["capture", "succeeded", "Saved nothing", 1]
  ]);
  assert.deepEqual(h.call("activityRuns", []), []);
});

test("a finished push says how big the store is and what changed since the push before it", () => {
  const push = (count) => job({ kind: "push", count, summary: "Store updated" });
  const items = [push(19), job({ kind: "push", status: "failed", count: null, summary: "Store updated" }), push(17), push(18), push(1)];
  assert.deepEqual(h.call("activityRuns", items).map((run) => run.summary), [
    "19 publications on your store, 2 more than before",
    "Store updated",
    "17 publications on your store, 1 fewer than before",
    "18 publications on your store, 17 more than before",
    "1 publication on your store"
  ]);
  assert.equal(h.call("pushDetail", [job({ kind: "push", status: "succeeded", count: null, summary: "Store updated" })], 0), null, "a push with no count keeps its stored summary");
});

/** [name, job, now, label, state word, tone, the thread it opens] */
const ROWS = [
  ["a finished capture reads as done, under its own title", job({ title: "Hiring lesson", summary: "Saved what you approved", cost_usd: 0.42 }), "Hiring lesson", "Done", "off", undefined],
  ["a run with no title is named for its kind", job({ kind: "synthesis", summary: "Read 3 notes" }), "Synthesis", "Done", "off", undefined],
  ["a kind the app does not know is named as it comes", job({ kind: "backup", summary: "" }), "backup", "Done", "off", undefined],
  ["a failed push says so, and opens nothing: a push has no thread", job({ kind: "push", status: "failed", summary: "The store did not answer" }), "Store update", "Failed", "attention", undefined],
  ["a run that never reported is unfinished, not successful", job({ kind: "synthesis", status: "incomplete", summary: "This run never reported finishing", finished_at: null }), "Synthesis", "Unfinished", "off", undefined],
  ["a run still going reads as running and opens its thread", job({ kind: "deploy", status: "running", summary: "", finished_at: null }), "Store deploy", "Running", "ok", "deploy"],
  ["a capture that failed today opens its thread", job({ kind: "capture", status: "failed", summary: "The model stopped answering", finished_at: "2026-10-30T08:00:00" }), "Capture", "Failed", "attention", "capture"],
  ["a capture that failed more than a day ago is history, not a way back in", job({ kind: "capture", status: "failed", summary: "The model stopped answering", started_at: "2026-10-28T08:00:00", finished_at: "2026-10-28T08:01:00" }), "Capture", "Failed", "attention", undefined],
  ["an unfinished run with no finish time is judged by when it started", job({ kind: "deploy", status: "incomplete", summary: "never reported", started_at: "2026-10-30T11:00:00", finished_at: null }), "Store deploy", "Unfinished", "off", "deploy"],
  ["a state the app does not know is shown as it comes, and like any run not yet a success opens its thread today", job({ status: "queued", summary: "" }), "Capture", "queued", "off", "capture"]
];

for (const [name, item, label, state, tone, task] of ROWS) {
  test(name, () => {
    const row = h.call("activityRow", { item, summary: item.summary, times: 1 }, NOW);
    assert.equal(row.label, label);
    assert.equal(row.state, state);
    assert.equal(row.tone, tone);
    assert.equal(row.task, task);
    assert.doesNotMatch(row.detail, /\$/, "never says what the agent cost");
  });
}

test("the detail line is the summary, the day it started, and how many times, with nothing empty left in", () => {
  const item = job({ summary: "Saved what you approved", started_at: "2026-10-30T09:00:00" });
  assert.equal(h.call("activityRow", { item, summary: item.summary, times: 4 }, NOW).detail, `Saved what you approved · ${when("2026-10-30T09:00:00")} · 4 times`);
  assert.equal(h.call("activityRow", { item, summary: item.summary, times: 1 }, NOW).detail, `Saved what you approved · ${when("2026-10-30T09:00:00")}`);
  assert.equal(h.call("activityRow", { item, summary: "", times: 1 }, NOW).detail, when("2026-10-30T09:00:00"));
  assert.equal(when("2026-10-30"), when("2026-10-30T12:00:00"), "a date with no time of day is that calendar day here");
  assert.equal(when("not a date"), "");
});

test("Settings draws Activity last, six rows at most, a thread link only where there is a thread to open", async () => {
  const items = [
    job({ id: 9, kind: "deploy", status: "running", title: "Store deploy", finished_at: null, started_at: new Date().toISOString() }),
    job({ id: 8, kind: "push", status: "failed", summary: "The store did not answer" }),
    job({ id: 7, kind: "push", count: 19, summary: "Store updated" }),
    job({ id: 6, kind: "synthesis", status: "incomplete", summary: "This run never reported finishing", finished_at: null }),
    job({ id: 5, kind: "capture", summary: "Saved what you approved", cost_usd: 0.3 }),
    job({ id: 4, kind: "push", count: 17, summary: "Store updated" }),
    job({ id: 3, kind: "capture", summary: "Saved nothing" }),
    job({ id: 2, kind: "capture", summary: "Saved nothing" })
  ];
  h.lore.answer("snapshot", emptySnapshot({ jobs: { items } }));
  h.signIn();
  await h.idle();
  assert.ok(!h.text("#content").includes("Activity"), "Today carries no Activity");
  h.call("show", "automations");
  assert.ok(!/Recent runs|Activity/.test(h.text("#content")), "Automations carries no run log");
  h.call("show", "settings");
  const sections = h.all("#content .section");
  const activity = sections.at(-1);
  assert.equal(activity.querySelector("h2")?.textContent, "Activity", "Activity is Settings' last section");
  const rows = [...activity.querySelectorAll(".row")];
  assert.equal(rows.length, 6, "six rows at most");
  assert.deepEqual(rows.map((row) => row.querySelector("b")?.textContent), ["Store deploy", "Store update", "Store update", "Synthesis", "Capture", "Store update"]);
  assert.deepEqual(rows.map((row) => row.querySelector(".run-state")?.textContent), ["Running", "Failed", "Done", "Unfinished", "Done", "Done"]);
  assert.equal(activity.querySelectorAll(".run-state .dot").length, rows.length, "each run's state is a dot and a word");
  assert.equal(activity.querySelector(".chip"), null, "not a chip");
  assert.deepEqual(rows.filter((row) => row.querySelector(".task-link")).map((row) => row.querySelector("b")?.textContent), ["Store deploy"], "only the run still going opens its thread");
  assert.match(activity.textContent, /19 publications on your store, 2 more than before/);
  assert.match(activity.textContent, /Saved what you approved/);
  assert.doesNotMatch(activity.textContent, /\$/, "an agent's cost is never shown");
  // An Activity row with a thread opens it, saying the run is still going.
  activity.querySelector(".task-link").click();
  await h.idle();
  assert.equal(h.text("#title"), "Store deploy");
  assert.equal(h.text("#eyebrow"), "Working · Running");
  assert.equal(h.document.getElementById("task-back").hidden, false);
});

test("an owner with no runs yet, or a CLI with none to give, sees no Activity section and the rest of Settings", async () => {
  for (const jobs of [{ items: [] }, undefined]) {
    const w = load();
    w.lore.answer("snapshot", emptySnapshot({ jobs }));
    w.signIn();
    await w.idle();
    w.call("show", "settings");
    assert.ok(!w.all("#content .section").some((node) => node.textContent.includes("Activity")), `jobs=${JSON.stringify(jobs)}`);
    assert.match(w.text("#content"), /Account/);
  }
});
