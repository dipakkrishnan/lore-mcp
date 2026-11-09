// APP-270: what the `jobs` walk checked of Automations in Settings until APP-270 folded it: a reading Codex ran (AUT-010)
// listed as Lore's own like any other, when it runs and when it runs next, no agent named, with Run now; and that the
// Automations section carries no run log (APP-214: that is Activity's). The take-over itself, Codex's task read and its
// rhythm kept, is tests/test_automation.py's TakeOverTest; the run log is renderer-activity.test.cjs. What the section
// looks like stays with the walks: views.json names the kept walk that scans `automations`.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

/** Next Sunday at 9 PM, local time: when a weekly Sunday reading at 21:00 runs next. */
const nextSunday = () => {
  const at = new Date();
  at.setDate(at.getDate() + ((7 - at.getDay()) % 7 || 7));
  at.setHours(21, 0, 0, 0);
  return at.toISOString();
};

/** The reading Codex ran every Sunday at 9 PM, as `lore automation list --json` gives it once Lore has taken it over. @returns {Routine} */
const takenOver = (next_run = nextSunday()) => ({ id: "synthesis", kind: "read", name: "Read connected apps", about: "Read what came in from the apps you connected", built_in: true, cadence: "weekly", day: 6, hour: 21, paused: false, last_run: null, result: "", next_run, due: false });

/** @param {Partial<Snapshot>} [over] */
async function automations(over = {}) {
  const h = load();
  const routine = takenOver();
  h.lore.answer("routines", [routine]);
  h.lore.answer("snapshot", emptySnapshot(over));
  h.boot();
  await h.idle();
  h.call("show", "automations");
  await h.idle();
  return { h, routine };
}

test("a reading Codex ran is Lore's now, listed under Automations in Settings like any other, with Run now and when it runs next", async () => {
  const { h, routine } = await automations();
  assert.equal(h.text("#title"), "Settings");
  const row = h.all("#automations .row").find((node) => node.querySelector("b")?.textContent === "Read connected apps");
  assert.ok(row, "the reading is listed under Automations");
  const text = row.textContent ?? "";
  assert.match(text, /Every Sunday at 9 PM/);
  assert.equal(/** @type {HTMLElement | null} */ (row.querySelector("[data-next]"))?.dataset.next, routine.next_run, "when it runs next is the CLI's next_run");
  assert.doesNotMatch(text, /Codex|Claude| by /, "no agent is named");
  assert.ok(row.querySelector(".routine-act[aria-label='Run now']"), "with Run now");
  assert.equal(row.querySelector(".routine-act[aria-label='Remove']"), null, "Lore's own can't be removed");
});

test("Automations, in Settings, carries no run log, only automations", async () => {
  const job = { id: 1, kind: "capture", status: "succeeded", title: "", summary: "Saved what you approved", count: null, cost_usd: null, started_at: "2026-10-30T09:00:00", finished_at: "2026-10-30T09:01:00" };
  const { h } = await automations({ jobs: { items: [/** @type {JobItem} */ (job)] } });
  const section = h.document.getElementById("automations");
  assert.ok(section?.querySelector(".automations"), "the Automations section lists automations");
  assert.doesNotMatch(section?.textContent ?? "", /Recent runs|Activity/);
  assert.match(h.text("#content"), /Saved what you approved/, "the run is in Settings' Activity, not under Automations");
});
