// APP-268: the price sheet's validation (APP-019, MON-040) as a table over what an owner can type, run on parsePrice(),
// priceEntry() and stalePrice() from the loaded renderer, then the sheet itself refusing in place as the `store` walk
// asserts it.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const h = load();
const ABOVE_ZERO = "A price has to be a number above zero. Free is a real choice, but you make it when you open your store.";
const WHOLE_COPIES = "Free copies has to be a whole number, zero or more.";

/** [typed, the amount, or null when the CLI would refuse it] */
const PRICES = [
  ["0.75", 0.75],
  [" 0.75 ", 0.75],
  ["$0.75", 0.75],
  ["$ 0.75", 0.75],
  ["1", 1],
  ["0.000001", 0.000001],
  ["1e-3", 0.001],
  ["0", null],
  ["0.00", null],
  ["-1", null],
  ["", null],
  ["   ", null],
  ["free", null],
  ["1,50", null],
  ["$", null],
  ["Infinity", null]
];

for (const [raw, amount] of PRICES) {
  test(`parsePrice(${JSON.stringify(raw)}) is ${amount}`, () => {
    assert.equal(h.call("parsePrice", raw), amount);
  });
}

/** [price typed, copies typed (undefined: a CLI without them), what comes of it] */
const ENTRIES = [
  ["0.75", undefined, { amount: 0.75, copies: null }],
  ["0.75", "3", { amount: 0.75, copies: 3 }],
  ["0.75", " 3 ", { amount: 0.75, copies: 3 }],
  ["0.75", "0", { amount: 0.75, copies: 0 }],
  ["0", undefined, { refused: ABOVE_ZERO }],
  ["0", "3", { refused: ABOVE_ZERO }],
  ["", "3", { refused: ABOVE_ZERO }],
  ["0.75", "", { refused: WHOLE_COPIES }],
  ["0.75", "  ", { refused: WHOLE_COPIES }],
  ["0.75", "1.5", { refused: WHOLE_COPIES }],
  ["0.75", "-1", { refused: WHOLE_COPIES }],
  ["0.75", "three", { refused: WHOLE_COPIES }],
  ["0", "", { refused: ABOVE_ZERO }]
];

for (const [raw, copies, expected] of ENTRIES) {
  test(`priceEntry(${JSON.stringify(raw)}, ${JSON.stringify(copies)}) ${"refused" in expected ? "is refused" : "is kept"}`, () => {
    assert.deepEqual(h.call("priceEntry", raw, copies), expected);
  });
}

/** [the store's price, the saved price, what the store still charges, or null] */
const STALE = [
  [0.02, 0.75, 0.02],
  [0.02, 0.02, null],
  [null, 0.75, null],
  [0.02, null, null],
  [null, null, null]
];

for (const [live, saved, stale] of STALE) {
  test(`stalePrice: store charges ${live}, owner saved ${saved}: ${stale === null ? "nothing stale" : `still ${stale}`}`, () => {
    const s = emptySnapshot({ pricing: { publication_usd: saved, answer_usd: null, answer_enabled: false }, node: { url: "https://store.example/mcp", selling: true, live: { state: "online", network: "eip155:84532", price_usd: live, payout: null } } });
    assert.equal(h.call("stalePrice", s), stale);
  });
}

test("the sheet opens on the price field, refuses zero in place and stays open, and saves a price by the IPC that sets it", async () => {
  h.lore.answer("snapshot", emptySnapshot({ pricing: { publication_usd: 0.02, answer_usd: null, answer_enabled: false, free_copies: 3 }, node: { url: "https://store.example/mcp", selling: true, store: "current", live: { state: "online", network: "eip155:84532", price_usd: 0.02, payout: null } } }));
  h.signIn();
  await h.idle();
  h.call("openPriceSheet");
  const sheet = h.document.querySelector("dialog.form-sheet[open]");
  assert.equal(sheet?.getAttribute("aria-label"), "Price");
  const amount = sheet.querySelector("input[aria-label='Price per publication in US dollars']");
  const copies = sheet.querySelector("input[aria-label='Free copies of each piece']");
  assert.equal(amount.value, "0.02", "the field starts on the saved price");
  assert.equal(copies.value, "3", "and the free copies the CLI has");
  assert.equal(h.document.activeElement, amount, "with focus on the price");
  assert.equal(sheet.querySelector(".form-foot .hint")?.textContent, "Buyers pay this for each piece, by card or through their AI agent.");
  assert.deepEqual([...sheet.querySelectorAll(".form-foot button")].map((button) => button.textContent), ["Cancel", "Save"]);
  h.lore.reset();
  amount.value = "0";
  amount.form.requestSubmit();
  await h.idle();
  assert.match(sheet.querySelector(".problem")?.textContent ?? "", /above zero/, "zero is refused in the sheet");
  assert.ok(sheet.hasAttribute("open"), "which stays open");
  assert.equal(h.lore.callsTo("setPrice").length, 0, "and nothing is sent");
  amount.value = "0.75";
  copies.value = "1.5";
  amount.form.requestSubmit();
  await h.idle();
  assert.match(sheet.querySelector(".problem")?.textContent ?? "", /whole number/, "half a copy is refused");
  copies.value = "3";
  amount.form.requestSubmit();
  await h.idle();
  assert.ok(!h.document.querySelector("dialog.form-sheet[open]"), "a saved price closes the sheet");
  assert.deepEqual(h.lore.callsTo("setPrice").map((call) => call.args), [[0.75]], "the price goes to main");
  assert.equal(h.lore.callsTo("setFreeCopies").length, 0, "unchanged free copies are not sent again");
  assert.ok(h.lore.callsTo("snapshot").length >= 1, "and the snapshot is read again");
});

test("an empty price field keeps Save disabled; a CLI without free copies shows no field for them", async () => {
  const w = load();
  w.lore.answer("snapshot", emptySnapshot({ pricing: { publication_usd: null, answer_usd: null, answer_enabled: false }, node: { url: "https://store.example/mcp", selling: true, store: "current", live: { state: "online", network: "eip155:84532", price_usd: null, payout: null } } }));
  w.signIn();
  await w.idle();
  w.call("openPriceSheet");
  const sheet = w.document.querySelector("dialog.form-sheet[open]");
  assert.equal(sheet.querySelector("input[aria-label='Free copies of each piece']"), null);
  const amount = sheet.querySelector("input[aria-label='Price per publication in US dollars']");
  assert.equal(amount.value, "");
  assert.equal(amount.placeholder, "0.01");
  const save = [...sheet.querySelectorAll("button")].find((button) => button.textContent === "Save");
  assert.equal(save.disabled, true, "nothing typed: Save waits");
  amount.value = "0.5";
  amount.dispatchEvent(new w.window.Event("input", { bubbles: true }));
  assert.equal(save.disabled, false);
  amount.value = "   ";
  amount.dispatchEvent(new w.window.Event("input", { bubbles: true }));
  assert.equal(save.disabled, true, "blanks are nothing");
});

test("Settings offers Set a price while none is saved, and Change with what buyers pay once one is", async () => {
  const w = load();
  const store = (publication_usd) => emptySnapshot({ pricing: { publication_usd, answer_usd: null, answer_enabled: false, free_copies: 3 }, node: { url: "https://store.example/mcp", selling: true, store: "current", live: { state: "online", network: "eip155:84532", price_usd: publication_usd, payout: null } } });
  w.lore.answer("snapshot", store(null));
  w.signIn();
  await w.idle();
  w.call("show", "settings");
  const priceRow = () => w.all("#content .row").find((node) => node.textContent.startsWith("Price"));
  assert.ok(priceRow(), w.text("#content"));
  assert.ok([...priceRow().querySelectorAll("button")].some((node) => node.textContent === "Set a price"));
  assert.ok(priceRow().textContent.includes("Not set"));
  w.lore.answer("snapshot", store(0.75));
  w.lore.emit({ type: "changed" });
  await w.idle();
  assert.ok([...priceRow().querySelectorAll("button")].some((node) => node.textContent === "Change"));
  assert.ok(priceRow().textContent.includes("$0.75 per piece \u00b7 first 3 copies free"), priceRow().textContent);
  assert.ok(!priceRow().textContent.includes("Not set"), "shows no price it doesn't have");
});
