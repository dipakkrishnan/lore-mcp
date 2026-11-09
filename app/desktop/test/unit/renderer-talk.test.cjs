// APP-269: talking it through (APP-290), as the `today` walk drove it with Chromium's fake microphone, now on the loaded
// renderer with a fake one: getUserMedia and AudioContext stand in for the Mac's audio, and window.lore.transcribe
// answers with what the owner "said". Every rule the walk checked is here: Inventory and the Inbox offer Record a memory,
// the thread opens listening, Enter sends what was said and Esc drops it, only the first turn listens on its own, and
// leaving, typing, silence or a card to approve ends it. What the listening composer looks like is the inventory walk's
// `talk-listening` shot.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const SPOKEN = "We held the price on the Acme renewal because they had no alternative.";

/** Signed in on the Inbox with a microphone that hears `heard()`, and every recording it opened. */
async function talking() {
  const h = load();
  const mic = { heard: SPOKEN, opened: 0, stopped: 0 };
  const { window } = h;
  Object.defineProperty(window.navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => { mic.opened++; return { getTracks: () => [{ stop: () => { mic.stopped++; } }] }; } } });
  const node = () => ({ connect() {}, disconnect() {} });
  window.AudioContext = class {
    destination = {};
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { return node(); }
    async close() {}
  };
  h.lore.answer("microphone", true);
  h.lore.answer("transcribe", () => mic.heard);
  h.boot();
  await h.idle();
  return { h, mic };
}
const listening = (/** @type {ReturnType<typeof load>} */ h) => h.document.getElementById("composer")?.dataset.mode === "listening";
const key = async (/** @type {ReturnType<typeof load>} */ h, /** @type {string} */ name) => {
  h.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
  await h.idle();
};
const prompts = (/** @type {ReturnType<typeof load>} */ h) => h.lore.callsTo("prompt").map((call) => /** @type {{text: string, task: string}} */ (call.args[0]));
/** Lore answers in the capture thread. @param {ReturnType<typeof load>} h @param {string} text */
const answer = async (h, text) => {
  h.lore.emit({ type: "working", active: true, task: "capture" });
  h.lore.emit({ type: "message", task: "capture", text });
  h.lore.emit({ type: "working", active: false, task: "capture" });
  await h.idle();
};
/** Record a memory from Inventory, with the composer cleared first. @param {ReturnType<typeof load>} h */
const talkAgain = async (h) => {
  h.call("show", "inventory");
  /** @type {HTMLTextAreaElement} */ (h.document.getElementById("capture-input")).value = "";
  /** @type {HTMLButtonElement} */ (h.document.getElementById("talk")).click();
  await h.idle();
  return listening(h);
};

test("Inventory and the Inbox offer Record a memory in the header; no other page does", async () => {
  const { h } = await talking();
  const talk = /** @type {HTMLButtonElement} */ (h.document.getElementById("talk"));
  h.call("show", "inventory");
  assert.equal(talk.hidden, false);
  assert.equal(talk.textContent, "Record a memory");
  h.call("show", "inbox");
  assert.equal(talk.hidden, false);
  for (const page of ["connectors", "settings", "bids"]) {
    h.call("show", page);
    assert.equal(talk.hidden, true, page);
  }
});

test("it opens a new memory's thread already listening; Enter sends what was said, and only Lore's answer ends the turn, leaving the microphone off", async () => {
  const { h, mic } = await talking();
  assert.ok(await talkAgain(h));
  assert.equal(h.text("#title"), "Capture a memory");
  assert.equal(h.text("#dictation-text"), "Listening… Tell Lore what you figured out. Enter sends it, Esc stops.");
  await key(h, "Enter");
  assert.deepEqual(prompts(h).map(({ text, task }) => ({ text, task })), [{ text: SPOKEN, task: "capture" }], "what was said goes to Lore as the owner's words");
  assert.equal(listening(h), false, "it doesn't listen again until Lore answers");
  assert.match(h.text("#log"), /We held the price on the Acme renewal/);
  assert.equal(mic.stopped, 1, "the microphone is let go");
  await answer(h, "What did they say when you held it?");
  assert.equal(listening(h), false, "Lore's answer leaves the microphone off: only the first turn listens on its own");
  /** @type {HTMLButtonElement} */ (h.document.getElementById("dictate")).click();
  await h.idle();
  assert.ok(listening(h), "the microphone button listens again when asked");
  await key(h, "Escape");
  assert.equal(listening(h), false, "Esc stops listening");
  assert.equal(prompts(h).length, 1, "and sends nothing");
  assert.equal(h.document.activeElement, h.document.getElementById("capture-input"), "leaving the owner typing");
  await answer(h, "Anything else?");
  assert.equal(listening(h), false, "and it stays off after Lore's next answer");
});

test("leaving the thread while listening stops the microphone, and Enter elsewhere sends and transcribes nothing", async () => {
  const { h, mic } = await talking();
  assert.ok(await talkAgain(h));
  h.call("show", "settings");
  await h.idle();
  assert.equal(listening(h), false);
  assert.equal(mic.stopped, 1, "the recording is stopped, its audio dropped");
  await key(h, "Enter");
  assert.equal(prompts(h).length, 0);
  assert.equal(h.lore.callsTo("transcribe").length, 0);
});

test("typing between a send and Lore's question ends talking it through", async () => {
  const { h } = await talking();
  assert.ok(await talkAgain(h));
  await key(h, "Enter");
  const box = /** @type {HTMLTextAreaElement} */ (h.document.getElementById("capture-input"));
  box.value = "Also,";
  box.dispatchEvent(new h.window.Event("input", { bubbles: true }));
  await answer(h, "Anything else?");
  assert.equal(listening(h), false);
});

test("an empty transcript ends talking it through without sending an empty turn", async () => {
  const { h, mic } = await talking();
  mic.heard = "";
  assert.ok(await talkAgain(h));
  await key(h, "Enter");
  assert.equal(listening(h), false);
  assert.equal(prompts(h).length, 0);
  await h.idle();
  assert.equal(listening(h), false, "and the microphone stays off");
});

test("a memory card to approve ends it: the owner is asked to look, not listened over", async () => {
  const { h, mic } = await talking();
  assert.ok(await talkAgain(h));
  h.lore.emit({ type: "memories", id: "talk-card", task: "capture", entries: [{ title: "Held the Acme price", content: SPOKEN, project: "p" }] });
  await h.idle();
  assert.equal(listening(h), false);
  assert.equal(mic.stopped, 1);
  assert.equal(prompts(h).length, 0);
});

test("a microphone Lore may not use says where to allow it, and never listens", async () => {
  const { h, mic } = await talking();
  h.lore.answer("microphone", false);
  h.call("show", "inventory");
  /** @type {HTMLButtonElement} */ (h.document.getElementById("talk")).click();
  await h.idle();
  assert.equal(listening(h), false);
  assert.equal(mic.opened, 0);
  assert.match(h.text("#log"), /Lore needs the microphone: System Settings → Privacy & Security → Microphone\./, "it says where to allow it, in the thread");
});
