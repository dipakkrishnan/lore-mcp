// APP-270: what the `sell` walk checked (APP-134, APP-282) until APP-270 folded it, now on the loaded renderer: the New
// menu offers Writing to sell beside Memory, Collection and Automation; it opens Sell something you wrote; and Draft it
// for sale keeps the pasted writing privately, then starts the publish thread from it. Elsewhere now: Inventory's header
// offering Record a memory and nothing else is renderer-talk.test.cjs; the preview page carrying free fields only is
// test/unit/app.test.cjs's "previews a draft's page with the store's renderer, free fields only"; the preview window
// running no script (its webPreferences) is Electron's alone and a line in the store walk. What the sheet looks like stays
// with the walks: views.json names the kept walk that scans `sell-writing-sheet`.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load } = require("../../support/renderer-harness.cjs");

const WRITING = "Our launch deck lost to four-minute demos.\nTwelve cold sends, zero replies.";

async function signedIn() {
  const h = load();
  h.boot();
  await h.idle();
  return h;
}
/** @param {ReturnType<typeof load>} h */
const openNew = async (h) => {
  /** @type {HTMLButtonElement} */ (h.document.getElementById("new-open")).click();
  await h.idle();
};
/** @param {ReturnType<typeof load>} h */
const writingSheet = async (h) => {
  await openNew(h);
  /** @type {HTMLButtonElement} */ (h.document.querySelector("#new-menu [data-new=writing]")).click();
  await h.idle();
  return h.document.querySelector("dialog.sheet[open]");
};

test("New lists Memory, Collection, Writing to sell and Automation, each with its key", async () => {
  const h = await signedIn();
  await openNew(h);
  assert.equal(h.document.getElementById("new-menu")?.hidden, false);
  assert.equal(h.all("#new-menu button").map((node) => node.textContent).join("|"), "MemoryM|CollectionC|Writing to sellW|AutomationA");
});

test("Writing to sell opens Sell something you wrote, and Draft it for sale waits for the writing", async () => {
  const h = await signedIn();
  const sheet = await writingSheet(h);
  assert.equal(sheet?.getAttribute("aria-label"), "Sell something you wrote");
  assert.equal(h.document.getElementById("new-menu")?.hidden, true, "the menu closes as the sheet opens");
  const primary = /** @type {HTMLButtonElement} */ (sheet?.querySelector(".btn.primary"));
  assert.equal(primary.textContent, "Draft it for sale");
  assert.equal(primary.disabled, true);
  assert.match(sheet?.textContent ?? "", /Saved privately to your Lore\. Nothing is public until you approve a draft\./);
});

test("Draft it for sale keeps the writing privately, titled by its first line, then starts the publish thread from it", async () => {
  const h = await signedIn();
  const sheet = await writingSheet(h);
  h.lore.answer("pasteMemory", (/** @type {{title: string, content: string}} */ input) => [{ id: 7, status: "private", title: input.title }]);
  const text = /** @type {HTMLTextAreaElement} */ (sheet?.querySelector("textarea"));
  text.value = WRITING;
  text.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  const primary = /** @type {HTMLButtonElement} */ (sheet?.querySelector(".btn.primary"));
  assert.equal(primary.disabled, false);
  /** @type {HTMLFormElement} */ (sheet?.querySelector("form")).requestSubmit();
  await h.idle();
  assert.deepEqual(h.lore.callsTo("pasteMemory").map((call) => ({ .../** @type {object} */ (call.args[0]) })), [{ title: "Our launch deck lost to four-minute demos.", content: WRITING }], "kept privately, once, under its first line");
  assert.equal(h.document.querySelector("dialog.sheet[open]"), null, "the sheet closes");
  const prompts = h.lore.callsTo("prompt").map((call) => /** @type {{text: string, task: string, memory?: number}} */ (call.args[0]));
  assert.equal(prompts.length, 1, "one turn starts");
  assert.equal(prompts[0].task, "publish");
  assert.equal(prompts[0].memory, 7, "from the memory it kept");
  assert.equal(prompts[0].text, 'Help me publish something from my Lore, starting from "Our launch deck lost to four-minute demos.".');
  assert.equal(h.text("#title"), "Publish from your Lore");
  assert.match(h.text("#log"), /starting from "Our launch deck lost to four-minute demos\."/);
});

test("a write that fails keeps the sheet open, says so, and starts nothing", async () => {
  const h = await signedIn();
  const sheet = await writingSheet(h);
  h.lore.failNext("pasteMemory", "disk full");
  const text = /** @type {HTMLTextAreaElement} */ (sheet?.querySelector("textarea"));
  text.value = WRITING;
  text.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  /** @type {HTMLFormElement} */ (sheet?.querySelector("form")).requestSubmit();
  await h.idle();
  assert.ok(h.document.querySelector("dialog.sheet[open]"), "the sheet stays open");
  assert.match(h.document.querySelector("dialog.sheet[open]")?.textContent ?? "", /Lore could not save that|disk full/);
  assert.equal(h.lore.callsTo("prompt").length, 0);
});
