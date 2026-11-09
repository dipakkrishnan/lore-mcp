// APP-270: what the retired `feedback` walk asserted (APP-105), now on the loaded renderer with window.lore faked: Report
// feedback lives in the account menu and opens its sheet as the menu closes, Send waits for a title and a description,
// one Send is one report however the owner edits or presses again while it is out, the receipt is said once it lands,
// and a report still in flight never closes a sheet the owner opened after it. The walk's relay answered slowly; here
// reportFeedback is held open by a promise the test settles. What the CLI does with a report is store.test.cjs ("report
// feedback validates before any CLI call…", "report feedback omits --email entirely…"). Layout stays with the walks:
// views.json names the kept walk that scans each view.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

/** A signed-in owner on a build with a feedback relay, and reportFeedback answering only when the test says so. */
async function owner() {
  const h = load();
  h.lore.answer("snapshot", emptySnapshot({ feedback: { available: true } }));
  /** @type {Array<(receipt: {url: string}) => void>} */
  const pending = [];
  h.lore.answer("reportFeedback", () => new Promise((done) => pending.push(done)));
  h.boot();
  await h.idle();
  /** Land the oldest report still out, as issue `n`. @param {number} n */
  const land = async (n) => {
    const done = pending.shift();
    assert.ok(done, "a report is out");
    done({ url: `https://github.com/dipakkrishnan/lore-mcp/issues/${n}` });
    await h.idle();
  };
  return { h, land };
}

const form = (/** @type {ReturnType<typeof load>} */ h) => /** @type {HTMLFormElement | null} */ (h.document.querySelector("dialog.sheet .feedback-form"));
const send = (/** @type {ReturnType<typeof load>} */ h) => /** @type {HTMLButtonElement} */ (form(h)?.querySelector(".btn.primary"));
/** Fill the title and the description, as typing would. @param {ReturnType<typeof load>} h @param {string} description */
const fill = (h, description, title = "Edge feedback") => {
  const sheet = /** @type {HTMLFormElement} */ (form(h));
  /** @type {HTMLInputElement} */ (sheet.querySelector("input.form-title")).value = title;
  /** @type {HTMLTextAreaElement} */ (sheet.querySelector("textarea")).value = description;
  sheet.dispatchEvent(new h.window.Event("input", { bubbles: true }));
};
const submit = async (/** @type {ReturnType<typeof load>} */ h) => {
  /** @type {HTMLFormElement} */ (form(h)).requestSubmit();
  await h.idle();
};
const openFeedback = async (/** @type {ReturnType<typeof load>} */ h) => {
  /** @type {HTMLElement} */ (h.document.getElementById("account")).click();
  /** @type {HTMLElement} */ (h.document.getElementById("feedback-open")).click();
  await h.idle();
};

test("Report feedback appears only on a build that can send it, in the account menu, and opens its sheet as the menu closes", async () => {
  const { h } = await owner();
  const button = /** @type {HTMLButtonElement} */ (h.document.getElementById("feedback-open"));
  assert.equal(button.hidden, false, "the button appears once a relay is configured");
  const menu = /** @type {HTMLElement} */ (h.document.getElementById("account-menu"));
  /** @type {HTMLElement} */ (h.document.getElementById("account")).click();
  assert.ok(menu.hasAttribute("data-popover-open"), "the account row opens the menu");
  assert.ok(menu.contains(button), "Report feedback sits in the account menu");
  button.click();
  await h.idle();
  assert.ok(!menu.hasAttribute("data-popover-open"), "the menu closes as the sheet opens");
  assert.ok(form(h), "the dialog opens");
  assert.equal(form(h)?.closest("dialog")?.getAttribute("aria-label"), "Report feedback");
  assert.equal(h.document.activeElement, form(h)?.querySelector("input.form-title"), "on its title");

  const none = load();
  none.lore.answer("snapshot", emptySnapshot({ feedback: { available: false } }));
  none.boot();
  await none.idle();
  assert.equal(/** @type {HTMLButtonElement} */ (none.document.getElementById("feedback-open")).hidden, true, "no relay, no button");
});

test("Send waits for a title and a description; one Send is one report, whatever is edited or pressed while it is out", async () => {
  const { h, land } = await owner();
  await openFeedback(h);
  assert.equal(send(h).disabled, true, "nothing filled");
  fill(h, "", "Edge feedback");
  assert.equal(send(h).disabled, true, "a title alone");
  fill(h, "Something to report", "");
  assert.equal(send(h).disabled, true, "a description alone");
  fill(h, "Something to report");
  assert.equal(send(h).disabled, false, "Send enables once both required fields are filled");
  await submit(h);
  assert.equal(send(h).textContent, "Sending…");
  // The walk's reproduction: editing a field mid-request used to re-enable Send.
  /** @type {HTMLTextAreaElement} */ (form(h)?.querySelector("textarea")).value = "Changed my mind";
  form(h)?.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  assert.equal(send(h).disabled, true, "editing a field mid-request leaves Send disabled");
  await submit(h);
  assert.equal(h.lore.callsTo("reportFeedback").length, 1, "a second submit while one is out files nothing");
  assert.deepEqual(JSON.parse(JSON.stringify(h.lore.callsTo("reportFeedback")[0].args)), [{ title: "Edge feedback", email: "", description: "Something to report" }]);
  await land(1);
  assert.match(h.text("#status"), /Filed as https:\/\/github\.com\/dipakkrishnan\/lore-mcp\/issues\/1/, "the report lands");
  assert.equal(form(h), null, "and its sheet closes");
  assert.equal(h.lore.callsTo("reportFeedback").length, 1, "one owner action filed exactly one issue");
});

test("a report still in flight never closes a sheet the owner opened after it", async () => {
  const { h, land } = await owner();
  await openFeedback(h);
  fill(h, "A second report");
  await submit(h);
  /** @type {HTMLElement} */ (h.document.getElementById("new-open")).click();
  /** @type {HTMLElement} */ (h.document.querySelector("#new-menu [data-new=writing]")).click();
  await h.idle();
  const writing = () => h.all("dialog.sheet").filter((dialog) => dialog.hasAttribute("open"));
  assert.deepEqual(writing().map((dialog) => dialog.getAttribute("aria-label")), ["Sell something you wrote"], "another sheet opens while the report is in flight");
  const text = /** @type {HTMLTextAreaElement} */ (writing()[0].querySelector("textarea"));
  text.value = "Half-pasted writing";
  text.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  await land(2);
  const open = h.all("dialog.sheet");
  assert.equal(open.length, 1, "one sheet");
  assert.equal(open[0].hasAttribute("open"), true);
  assert.equal(open[0].getAttribute("aria-label"), "Sell something you wrote", "the in-flight report did not close the sheet opened after it");
  assert.equal(/** @type {HTMLTextAreaElement} */ (open[0].querySelector("textarea")).value, "Half-pasted writing", "nor what was typed into it");
  assert.equal(h.lore.callsTo("reportFeedback").length, 1, "the second report filed once");
});
