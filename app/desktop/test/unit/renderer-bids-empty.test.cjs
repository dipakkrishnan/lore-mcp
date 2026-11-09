// APP-269: the Bids page with no board to read (APP-288), as the `faq` walk checked it from the sidebar: it opens on
// what the owner knows and says nothing matches yet, All says there are no open bids, the sidebar's count stays empty,
// and the page tabs are Bids' alone. The sidebar's places, the account menu and the FAQ itself are
// renderer-account-menu.test.cjs and renderer-faq.test.cjs.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load } = require("../../support/renderer-harness.cjs");

test("with no board, Bids says nothing matches yet, All says there are no open bids, and the tabs are Bids' alone", async () => {
  const h = load();
  h.boot();
  await h.idle();
  /** @type {HTMLButtonElement} */ (h.document.querySelector("nav [data-view=bids]")).click();
  await h.idle();
  assert.equal(h.text("#title"), "Bids");
  assert.equal(h.text("#content"), "Nothing on the board matches what you know yet");
  assert.equal(h.text("[data-count=bids]"), "", "no count in the sidebar");
  assert.equal(h.document.getElementById("page-tabs")?.hidden, false);
  const all = h.all("#page-tabs .ptab").find((tab) => tab.textContent?.startsWith("All"));
  /** @type {HTMLButtonElement} */ (all).click();
  await h.idle();
  assert.equal(h.text("#content"), "No open bids");
  h.call("show", "inbox");
  assert.equal(h.document.getElementById("page-tabs")?.hidden, true, "the tabs are Bids' alone");
});
