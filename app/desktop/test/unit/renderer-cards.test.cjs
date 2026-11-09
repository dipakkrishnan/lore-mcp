// APP-270: what the retired `cards` walk (XC-039) asserted of Settings → Your store → Get paid → By card, now on the
// loaded renderer with window.lore's card calls faked: from "Get paid to your bank" through Stripe needing more, Stripe
// checking, a price under the card minimum, to card payments coming on by themselves once Stripe has cleared and the
// price can be charged. Where the form's link goes and that one account is opened however often the owner finishes later
// are the CLI's (tests/test_cards.py, tests/test_cli.py); the main process opening that link is test/unit/cards.test.cjs.
// What the row looks like stays with the walks: views.json names the kept walks that scan Settings.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const ACCOUNT = "acct_1EdgeSeller";
const STRIPE_FORM = "Finish with Stripe in your browser, then come back here.";
/** @param {Partial<CardStatus>} over @returns {CardStatus} */
const status = (over = {}) => ({ account: "", pending: "", ready: null, checking: false, minimum_usd: 0.5, ...over });
/** A store online on real money, with a price per piece. @param {number} price */
const store = (price) => emptySnapshot({
  pricing: { publication_usd: price, answer_usd: null, answer_enabled: false, free_copies: 0 },
  node: { url: "https://lore-edge.example.workers.dev/mcp", agents: null, selling: true, store: "current", live: { state: "online", network: "eip155:8453", payout: null, price_usd: price } }
});

/** Settings, signed in, with the card status Lore reads answering `first`. @param {CardStatus} first @param {number} [price] */
async function settings(first, price = 3) {
  const h = load();
  h.lore.answer("snapshot", store(price));
  h.lore.answer("cardStatus", first);
  h.boot();
  await h.idle();
  h.call("show", "settings");
  await h.idle();
  return h;
}
const cardsRow = (/** @type {ReturnType<typeof load>} */ h) => h.all("#content .way").find((node) => node.textContent?.startsWith("By card"));
const priceRow = (/** @type {ReturnType<typeof load>} */ h) => h.all("#content .row").find((node) => node.querySelector(".t b")?.textContent === "Price");
const press = async (/** @type {ReturnType<typeof load>} */ h, /** @type {string} */ label) => {
  const button = [...(cardsRow(h)?.querySelectorAll("button") ?? [])].find((node) => node.textContent === label);
  assert.ok(button, `the By card row offers ${label}: ${cardsRow(h)?.textContent}`);
  button.click();
  await h.idle();
};

test("Settings offers to get paid to the bank by card, and pressing it opens Stripe's form through Lore and says to finish there", async () => {
  const h = await settings(status());
  assert.match(cardsRow(h)?.textContent ?? "", /Get paid to your bank/);
  assert.match(cardsRow(h)?.textContent ?? "", /Stripe checks who you are and pays you out to your bank/);
  // Once the form is open, Stripe has an account that needs the owner.
  h.lore.answer("cardStatus", status({ pending: ACCOUNT, ready: false }));
  await press(h, "Get paid to your bank");
  assert.equal(h.lore.callsTo("connectCards").length, 1, "one account opened through Lore's checkout");
  assert.match(h.text("#status"), new RegExp(STRIPE_FORM));
});

test("while Stripe needs more, the row says so and offers the form again; finishing later asks Lore for the same form", async () => {
  const h = await settings(status({ pending: ACCOUNT, ready: false }));
  const text = cardsRow(h)?.textContent ?? "";
  assert.match(text, /Stripe needs a few more details from you/);
  assert.match(text, /Needs you/);
  assert.match(text, /Finish with Stripe/);
  assert.equal(cardsRow(h)?.querySelector(".status-pill.attention")?.textContent, "Needs you");
  await press(h, "Finish with Stripe");
  // The CLI reopens the pending account rather than opening a second (tests/test_cli.py
  // test_connect_opens_one_account_and_reuses_it_until_stripe_clears_it); the app asks it the same way each time.
  assert.equal(h.lore.callsTo("connectCards").length, 1);
  assert.deepEqual(h.lore.callsTo("connectCards")[0].args, []);
  assert.match(h.text("#status"), new RegExp(STRIPE_FORM));
});

test("while Stripe verifies, the row says it is checking with nothing for the owner to do, and the notice to finish the form clears itself", async () => {
  const h = await settings(status({ pending: ACCOUNT, ready: false }));
  await press(h, "Finish with Stripe");
  assert.match(h.text("#status"), new RegExp(STRIPE_FORM));
  // Back from the browser: the window's focus reads the status again.
  h.lore.answer("cardStatus", status({ pending: ACCOUNT, ready: false, checking: true }));
  h.window.dispatchEvent(new h.window.Event("focus"));
  await h.idle();
  const text = cardsRow(h)?.textContent ?? "";
  assert.match(text, /Stripe is checking your details/);
  assert.equal(cardsRow(h)?.querySelector("button"), null, "nothing for the owner to do");
  assert.doesNotMatch(h.text("#status"), new RegExp(STRIPE_FORM));
});

test("Stripe cleared with the price under the card minimum: warned once, on the price row; the card line only says what to do", async () => {
  const h = await settings(status({ pending: ACCOUNT, ready: true }), 0.25);
  assert.match(priceRow(h)?.textContent ?? "", /Card payments need at least \$0\.50/);
  assert.equal((h.text("#content").match(/\$0\.50/g) ?? []).length, 1, "the minimum is said once on the page");
  const text = cardsRow(h)?.textContent ?? "";
  assert.match(text, /once you raise your price/);
  assert.equal(cardsRow(h)?.querySelector(".pill, .status-pill"), null, "no pill on the card line");
  assert.equal(h.lore.callsTo("switchCards").length, 0, "cards do not come on under the minimum");
});

test("once Stripe has cleared and the price can be charged, cards come on by themselves into the cleared account, with Turn off", async () => {
  const h = await settings(status({ pending: ACCOUNT, ready: true }), 0.25);
  assert.equal(h.lore.callsTo("switchCards").length, 0);
  // The owner raises the price: nothing is left for them to decide.
  h.lore.answer("snapshot", store(3));
  h.lore.answer("cardStatus", status({ account: ACCOUNT, ready: true }));
  h.set("cards", status({ pending: ACCOUNT, ready: true }));
  await h.run("load()");
  await h.idle();
  assert.deepEqual(h.lore.callsTo("switchCards").map((call) => call.args), [[ACCOUNT]], "turned on once, into the account Stripe cleared");
  assert.doesNotMatch(priceRow(h)?.textContent ?? "", /Card payments need/);
  const text = cardsRow(h)?.textContent ?? "";
  assert.match(text, /Turn off/);
  assert.equal(cardsRow(h)?.querySelector(".status-pill.ok")?.textContent, "On");
  assert.match(h.text("#status"), /Card payments are on/);
  await press(h, "Turn off");
  assert.deepEqual(h.lore.callsTo("switchCards").map((call) => call.args), [[ACCOUNT], [null]], "Turn off turns them off");
});
