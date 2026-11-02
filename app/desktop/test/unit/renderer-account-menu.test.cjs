// APP-268: the workspace (account) menu's rules (APP-201) as the `faq` walk asserts them: what its first line says for
// who is signed in and how the store stands, which items show, and how the keyboard moves through it. accountState()
// is tabled; the rest is driven through the loaded renderer. Whether the popover is drawn open is Chromium's, not
// jsdom's: here the harness marks it with data-popover-open and fires the toggle event the renderer listens for.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const h = load();
const signedIn = (providerId, type = "oauth") => ({ credentials: [{ providerId, type }] });
const store = (state, selling = true) => emptySnapshot({ node: { url: "https://store.example/mcp", agents: null, selling, store: "current", live: { state, network: "eip155:84532", price_usd: 0.02, payout: null } } });

/** [name, who is signed in, the snapshot, the line, whether Sign out shows] */
const LINES = [
  ["nobody signed in", null, null, "Not signed in", false],
  ["nobody, even with a snapshot", { credentials: [] }, store("online"), "Not signed in", false],
  ["Claude, before the first snapshot", signedIn("anthropic"), null, "Signed in with Claude", true],
  ["ChatGPT, by subscription", signedIn("openai-codex"), emptySnapshot(), "Signed in with ChatGPT", true],
  ["OpenAI, by API key", signedIn("openai", "api_key"), emptySnapshot(), "Signed in with OpenAI", true],
  ["a provider the app does not know is named by its id", signedIn("mistral", "api_key"), emptySnapshot(), "Signed in with mistral", true],
  ["no store yet: no store word", signedIn("anthropic"), emptySnapshot(), "Signed in with Claude", true],
  ["a store open for sale is live", signedIn("anthropic"), store("online"), "Signed in with Claude · Store live", true],
  ["a store online for the owner's agents only is online, not live", signedIn("anthropic"), store("online", false), "Signed in with Claude · Store online", true],
  ["a store that isn't answering is offline", signedIn("anthropic"), store("unreachable"), "Signed in with Claude · Store offline", true],
  ["a store with an address but no record of going live is not set up", signedIn("anthropic"), store("not_configured"), "Signed in with Claude · Store not set up", true],
  ["the first credential is the one named", { credentials: [{ providerId: "openai-codex", type: "oauth" }, { providerId: "anthropic", type: "oauth" }] }, emptySnapshot(), "Signed in with ChatGPT", true]
];

for (const [name, status, snapshot, line, signOut] of LINES) {
  test(`accountState: ${name}`, () => {
    assert.deepEqual(h.call("accountState", status, snapshot), { line, signOut });
  });
}

test("the sidebar lists only the four main places; Settings, help and feedback live in the account menu", async () => {
  h.signIn();
  await h.idle();
  assert.deepEqual(h.all("nav button").map((button) => button.dataset.view), ["today", "inventory", "connectors", "automations"]);
  const menu = h.document.getElementById("account-menu");
  assert.ok(menu.contains(h.document.getElementById("feedback-open")), "feedback is in the menu");
  assert.equal(h.document.querySelector("aside > .feedback-open"), null, "and nowhere else");
  assert.equal(menu.getAttribute("role"), "menu");
  assert.equal(h.document.getElementById("account").getAttribute("aria-haspopup"), "menu");
});

const menuText = () => h.all("#account-menu button:not([hidden]), #account-menu p").map((node) => node.textContent).join("|");

test("the menu reads: who is signed in, then Settings, Help & FAQ, feedback only when it can be sent, Dark mode and Sign out", async () => {
  h.lore.answer("snapshot", emptySnapshot());
  h.signIn();
  await h.idle();
  assert.equal(menuText(), "Signed in with Claude|Settings⌘,|Help & FAQ|Dark mode|Sign out");
  assert.ok(h.all("#account-menu button:not([hidden])").every((button) => button.querySelector(":scope > svg")), "each item with its icon");
  h.lore.answer("snapshot", { ...store("online"), feedback: { available: true } });
  h.lore.emit({ type: "changed" });
  await h.idle();
  assert.equal(menuText(), "Signed in with Claude · Store live|Settings⌘,|Help & FAQ|Report feedback|Dark mode|Sign out", "a build with a relay offers feedback");
  h.set("auth", { credentials: [] });
  h.call("renderAccount");
  assert.equal(menuText(), "Not signed in|Settings⌘,|Help & FAQ|Report feedback|Dark mode", "signed out: no Sign out");
});

test("opening the menu says so on its button and puts focus on its first item; the arrow keys cycle through the items", async () => {
  h.lore.answer("snapshot", emptySnapshot());
  h.signIn();
  await h.idle();
  const account = h.document.getElementById("account");
  const menu = h.document.getElementById("account-menu");
  account.click();
  assert.equal(account.getAttribute("aria-expanded"), "true");
  assert.equal(h.document.activeElement, menu.querySelector("[data-view=settings]"), "focus on its first item");
  const items = h.all("#account-menu button:not([hidden])").map((button) => button.textContent);
  const press = (key) => menu.dispatchEvent(new h.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  const focused = () => h.document.activeElement.textContent;
  press("ArrowDown");
  assert.equal(focused(), items[1]);
  press("ArrowUp");
  press("ArrowUp");
  assert.equal(focused(), items.at(-1), "up from the first wraps to Sign out");
  press("ArrowDown");
  assert.equal(focused(), items[0], "down from the last wraps to Settings");
  const other = new h.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
  menu.dispatchEvent(other);
  assert.equal(other.defaultPrevented, false, "other keys are left to the browser");
  menu.querySelector("[data-view=settings]").click();
  assert.equal(h.text("#title"), "Settings", "Settings opens Settings");
  assert.equal(account.getAttribute("aria-expanded"), "false", "and the menu closes");
});

test("⌘, opens Settings from anywhere; Sign out signs the first credential out", async () => {
  h.lore.answer("snapshot", emptySnapshot());
  h.signIn();
  await h.idle();
  h.call("show", "connectors");
  h.document.dispatchEvent(new h.window.KeyboardEvent("keydown", { key: ",", metaKey: true, bubbles: true, cancelable: true }));
  assert.equal(h.text("#title"), "Settings");
  h.lore.reset();
  h.lore.answer("logout", { credentials: [] });
  h.document.getElementById("sign-out").click();
  await h.idle();
  assert.deepEqual(h.lore.callsTo("logout").map((call) => call.args), [["anthropic"]]);
  assert.equal(h.document.body.dataset.state, "welcome", "signed out, the welcome screen is back");
});

test("Dark mode says what the window is drawn in, and flips the appearance the other way", async () => {
  for (const dark of [false, true]) {
    const w = load({ dark });
    w.signIn();
    await w.idle();
    const toggle = w.document.getElementById("dark-mode");
    assert.equal(toggle.getAttribute("aria-checked"), String(dark), `dark=${dark}`);
    assert.equal(toggle.getAttribute("role"), "menuitemcheckbox");
    w.lore.reset();
    toggle.click();
    assert.deepEqual(w.lore.callsTo("setAppearance").map((call) => call.args), [[dark ? "light" : "dark"]]);
    assert.equal(w.get("appearance"), dark ? "light" : "dark");
  }
});
