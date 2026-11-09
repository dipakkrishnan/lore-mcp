// APP-270: what the retired `provision` walk asserted of setup failing (Fix 4), now on the loaded renderer: main's
// progress event with an error puts the welcome screen in its provisioning state, names the failure and offers Try
// again; Try again asks main to set up again and says so; the progress event that says setup finished clears the banner
// and the provisioning state, and the welcome screen is back to signing in. That every call needing the agent is refused
// with "still setting up" until it exists, then goes through, is test/unit/ipc.test.cjs's "every call that needs the
// agent is refused with one plain sentence before it exists, and goes through once it does"; that setup:retry boots
// again only while there is no agent is its "setup:retry boots again only while there is still no agent". The live
// launch that fails and recovers, and the welcome screen's layout, stay with the seller walk (views.json, `welcome`).
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load } = require("../../support/renderer-harness.cjs");

const NOT_READY = "Lore is still setting up on this Mac.";

test("setup that fails names the failure on the welcome screen and offers Try again, which asks main to set up again", async () => {
  const h = load({ answers: { agentStatus: new Error(NOT_READY) } });
  h.boot();
  await h.idle();
  h.lore.emit({ type: "progress", error: "Lore could not finish setting up on this Mac." });
  await h.idle();
  const welcome = /** @type {HTMLElement} */ (h.document.getElementById("welcome"));
  const retry = /** @type {HTMLButtonElement} */ (h.document.getElementById("welcome-retry"));
  assert.equal(h.document.body.dataset.state, "welcome");
  assert.equal(welcome.hidden, false);
  assert.ok(welcome.classList.contains("provisioning"));
  assert.equal(h.text("#welcome-note"), "Lore could not finish setting up on this Mac.", "the banner names the failure");
  assert.equal(retry.hidden, false, "Try again is offered");

  h.lore.reset();
  retry.click();
  await h.idle();
  assert.deepEqual(h.lore.names(), ["retrySetup"], "Try again asks main to set up again, and nothing else");
  assert.equal(retry.hidden, true);
  assert.equal(h.text("#welcome-note"), "Setting Lore up on this Mac…");
});

test("once setup finishes, the banner and the provisioning state clear and the welcome screen is back to signing in", async () => {
  const h = load({ answers: { agentStatus: new Error(NOT_READY) } });
  h.boot();
  await h.idle();
  h.lore.emit({ type: "progress", error: "Lore could not finish setting up on this Mac." });
  await h.idle();
  /** @type {HTMLButtonElement} */ (h.document.getElementById("welcome-retry")).click();
  await h.idle();
  h.lore.answer("agentStatus", { credentials: [] });
  h.lore.reset();
  h.lore.emit({ type: "progress", done: true });
  await h.idle();
  const welcome = /** @type {HTMLElement} */ (h.document.getElementById("welcome"));
  assert.ok(!welcome.classList.contains("provisioning"), "out of the provisioning state");
  assert.equal(h.text("#welcome-note"), "", "the banner is gone");
  assert.ok(h.lore.names().includes("agentStatus"), "the sign-in is checked again, now that the agent answers");
  assert.equal(h.document.body.dataset.state, "welcome");
  assert.equal(welcome.hidden, false, "signed out, the welcome screen offers the sign-in");

  // Signed in, the same finish lands in the app.
  h.lore.answer("agentStatus", { credentials: [{ providerId: "anthropic", type: "oauth" }] });
  h.lore.emit({ type: "progress", done: true });
  await h.idle();
  assert.equal(h.document.body.dataset.state, "app");
});
