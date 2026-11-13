// CAP-002: a proposed memory names the earlier memories it grows out of, each with its reason, on the same card that
// keeps it; the owner can strike a link, and only the links left are kept.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load } = require("../../support/renderer-harness.cjs");

test("a memory card shows each proposed link with its reason, and keeps only the links the owner leaves", async () => {
  const h = load();
  h.boot();
  await h.idle();
  h.lore.emit({
    type: "memories",
    id: "links-card",
    task: "capture",
    entries: [
      {
        title: "Pricing lesson",
        content: "Price the first tier low.",
        related: [
          { id: 4, title: "Failed launch at Actively", reason: "Learned from the failed launch." },
          { id: 9, title: "A guess", reason: "Maybe related." }
        ]
      }
    ]
  });
  await h.idle();
  const card = h.document.querySelector(".memory-links");
  assert.ok(card, "the links show on the card");
  assert.match(card.textContent ?? "", /Failed launch at Actively.*Learned from the failed launch\./);
  assert.match(card.textContent ?? "", /A guess.*Maybe related\./);
  const strike = [...h.document.querySelectorAll(".memory-links button")].find((b) => b.getAttribute("aria-label") === "Remove the link to A guess");
  assert.ok(strike, "each link can be struck");
  /** @type {HTMLButtonElement} */ (strike).click();
  await h.idle();
  assert.doesNotMatch(h.document.querySelector(".memory-links")?.textContent ?? "", /A guess/);
  const keep = [...h.document.querySelectorAll("button")].find((b) => b.textContent === "Keep this memory");
  /** @type {HTMLButtonElement} */ (keep).click();
  await h.idle();
  const [{ args }] = h.lore.callsTo("respond");
  // Through JSON, as it crosses to main: the page's objects come from another realm.
  assert.deepEqual(JSON.parse(JSON.stringify(/** @type {{value: {entries: unknown[]}}} */ (args[0]).value.entries)), [
    { title: "Pricing lesson", content: "Price the first tier low.", related: [{ id: 4, title: "Failed launch at Actively", reason: "Learned from the failed launch." }] }
  ]);
});

test("a memory with no links shows none and keeps none", async () => {
  const h = load();
  h.boot();
  await h.idle();
  h.lore.emit({ type: "memories", id: "plain-card", task: "capture", entries: [{ title: "Plain", content: "Plain text." }] });
  await h.idle();
  assert.equal(h.document.querySelector(".memory-links"), null);
});
