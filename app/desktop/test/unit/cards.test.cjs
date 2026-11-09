// APP-270: the main-process half of what the retired `cards` walk (XC-039) asserted: pressing Get paid to your bank opens
// Stripe's form in the browser through Lore's checkout, and the card calls reach the CLI and nothing else. The link
// itself (the checkout's /onboard?account=…&token=…) and one account reused until Stripe clears it are the CLI's:
// tests/test_cards.py test_the_onboarding_link_goes_through_the_checkout_and_asks_it_nothing and tests/test_cli.py
// test_connect_opens_one_account_and_reuses_it_until_stripe_clears_it. The row's states are renderer-cards.test.cjs.
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { after, test } = require("node:test");
const reading = require("../../src/reading.cjs");
const { Ipc } = require("../../src/ipc.cjs");

const root = mkdtempSync(join(tmpdir(), "cards-unit-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** The card channels over a recording ipcMain and shell, with the bridge's card calls answered by `bridge`.
 * @param {Record<string, any>} bridge */
function harness(bridge) {
  const userData = mkdtempSync(join(root, "user-"));
  /** @type {Map<string, (...args: any[]) => any>} */
  const handlers = new Map();
  const opened = /** @type {string[]} */ ([]);
  const main = {
    ipcMain: { handle: (/** @type {string} */ channel, /** @type {any} */ fn) => void handlers.set(channel, fn) },
    shell: { openExternal: async (/** @type {string} */ url) => void opened.push(url), openPath: async () => "" },
    clipboard: { writeText() {} },
    dialog: {},
    systemPreferences: {},
    BrowserWindow: class {},
    paths: { userData, temp: userData, home: userData },
    notify: () => {},
    emit: () => {},
    reveal: () => {},
    getWindow: () => undefined,
    createWindow: () => ({}),
    getAgent: () => undefined,
    requests: { ask: async () => undefined },
    badge: new reading.Badge(() => {}),
    bids: { matches: async () => [], board: async () => [], dismiss: async () => {}, find: async () => null },
    updates: {},
    appearance: {},
    boot: async () => {},
    onFocus: () => {}
  };
  const fake = { STORE: join(root, "no-store"), ATTENDED_KEYS: join(root, "keys", "attended"), lore: async () => "", sourceCatalog: async () => [], ...bridge };
  const ipc = Ipc(/** @type {any} */ (main), /** @type {any} */ (fake));
  ipc.register(join(root, "home"), /** @type {any} */ ({ runNow: async () => {}, check: async () => {} }), /** @type {any} */ ({ check: async () => {} }), /** @type {any} */ ({ mark() {}, push: async () => true }));
  const call = (/** @type {string} */ channel, /** @type {any[]} */ ...args) => /** @type {any} */ (handlers.get(channel))({}, ...args);
  return { call, opened };
}

const FORM = `https://checkout.yourlore.dev/onboard?account=acct_1EdgeSeller&token=${"a".repeat(64)}`;

test("Get paid to your bank opens Stripe's form, through Lore's checkout, in the browser", async () => {
  let connects = 0;
  const h = harness({ connectCards: async () => { connects++; return { account: "acct_1EdgeSeller", url: FORM }; } });
  await h.call("cards:connect");
  assert.equal(connects, 1);
  assert.deepEqual(h.opened, [FORM]);
  assert.match(h.opened[0], /\/onboard\?account=acct_1EdgeSeller&token=a{64}$/);
  // Finishing later asks again, and the CLI hands back the same account's form.
  await h.call("cards:connect");
  assert.deepEqual(h.opened, [FORM, FORM], "the same account's form, opened again");
});

test("a checkout run locally opens too; anything that isn't a web page never does", async () => {
  for (const [url, opens] of /** @type {Array<[string, boolean]>} */ ([[`http://localhost:8787/onboard?account=acct_1&token=${"a".repeat(64)}`, true], ["http://checkout.example/onboard", false], ["file:///etc/passwd", false], ["javascript:alert(1)", false]])) {
    const h = harness({ connectCards: async () => ({ account: "acct_1", url }) });
    await h.call("cards:connect");
    assert.deepEqual(h.opened, opens ? [url] : [], url);
  }
});

test("card status and switching reach the CLI's card calls as they are", async () => {
  /** @type {Array<string | null>} */
  const switched = [];
  const answer = { account: "", pending: "acct_1EdgeSeller", ready: true, checking: false, minimum_usd: 0.5 };
  const h = harness({ cardStatus: async () => answer, switchCards: async (/** @type {string} */ _home, /** @type {string | null} */ account) => void switched.push(account) });
  assert.equal(await h.call("cards:status"), answer);
  await h.call("cards:switch", "acct_1EdgeSeller");
  await h.call("cards:switch", null);
  assert.deepEqual(switched, ["acct_1EdgeSeller", null]);
});

test("switching cards refuses anything but a Stripe account id before any CLI call", async () => {
  const { switchCards } = require("../../src/state.cjs");
  for (const account of ["", "acct_", "acct_1; rm -rf /", "cus_1Edge", "--help"]) {
    await assert.rejects(() => switchCards(join(root, "home"), account), { message: "Invalid Stripe account" }, account);
  }
});
