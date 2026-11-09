// APP-268: the FAQ's wording (APP-118) as the `faq` walk asserts it: what it says, what it never promises, and the one
// line that turns on state (the owner's price), run on faqPrice() and renderFaq() from the loaded renderer.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const h = load();

/** [the owner's price, the answer to "What does a buyer pay?"] */
const PRICES = [
  [null, "Your price. You set what a publication costs on For Sale, before your store opens."],
  [0.75, "Your price. Yours is $0.75 a publication, set on For Sale."],
  [1, "Your price. Yours is $1.00 a publication, set on For Sale."],
  [0.000001, "Your price. Yours is $0.000001 a publication, set on For Sale."]
];

for (const [usd, line] of PRICES) {
  test(`faqPrice(${usd}) says "${line}"`, () => {
    assert.equal(h.call("faqPrice", usd), line);
  });
}

/** The FAQ as the renderer draws it for `s`: every question and its answer, in order. @param {Snapshot} s */
function faq(s) {
  const content = h.document.createElement("div");
  content.append(...h.call("renderFaq", s));
  const rows = [...content.querySelectorAll(".row")];
  return { content, text: content.textContent, questions: rows.map((row) => row.querySelector("b")?.textContent), rows, headings: [...content.querySelectorAll("h2")].map((node) => node.textContent) };
}

test("the FAQ opens on what Lore is, then how to start, with at least nine questions under four headings", () => {
  const { questions, headings } = faq(emptySnapshot());
  assert.equal(questions[0], "What is Lore?");
  assert.equal(questions[1], "How do I start?");
  assert.ok(questions.length >= 9, `${questions.length} questions`);
  assert.deepEqual(headings, ["Getting started", "Getting paid", "Privacy", "If you build agents"]);
  assert.deepEqual(questions, ["What is Lore?", "How do I start?", "Why connect my apps?", "What sells?", "Who buys?", "What does a buyer pay?", "How do I get paid?", "How do buyers find me?", "What leaves this Mac?", "Can I take something off sale?", "How do I buy?"]);
});

test("it says Lore never holds the money, and how both ways of getting paid work", () => {
  const { text } = faq(emptySnapshot());
  assert.match(text, /never holds your money/);
  assert.match(text, /By card: Stripe pays you out to your bank/);
  assert.match(text, /Agents can also pay a wallet you control directly/);
});

test("it promises no control that isn't there, and no earnings: the only dollar figure is the owner's price", () => {
  for (const usd of [null, 0.75]) {
    const { text } = faq(emptySnapshot({ pricing: { publication_usd: usd, answer_usd: null, answer_enabled: false } }));
    assert.doesNotMatch(text, /turn on questions|ask you one|Questions have|play money/i);
    assert.ok((text.match(/\$\d/g) ?? []).length <= (usd === null ? 0 : 1), text.match(/\$\d[^ ]*/g)?.join(",") ?? "");
    assert.doesNotMatch(text, /\bearn|income|revenue|passive/i);
  }
});

test("no jargon", () => {
  const { text } = faq(emptySnapshot());
  const jargon = /\bMCP\b|x402|\bnode\b|worker|deploy|mainnet|testnet|endpoint|\bAPI\b|crypto|blockchain/i;
  assert.doesNotMatch(text, jargon, text.match(jargon)?.[0]);
});

test("the buyer fork is one row that opens the buyer skill in the browser", () => {
  const { content, rows } = faq(emptySnapshot());
  assert.equal(rows.filter((row) => row.textContent.includes("How do I buy?")).length, 1);
  const link = content.querySelector("a[href*='lore-buy']");
  assert.ok(link, "a link to the buyer skill");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noreferrer");
  assert.equal(link.textContent, "Get the buyer skill ↗");
});

test("the FAQ is a view: the account menu's Help & FAQ lands on it, and nothing about selling is added to the Inbox or Settings", async () => {
  h.lore.answer("snapshot", emptySnapshot({ library: { counts: { private: 1 }, sources: [], items: [{ id: 1, title: "A memory", project_label: "p", status: "private", updated_at: "2026-10-30", sources: [], arrival: 1 }] } }));
  h.signIn();
  await h.idle();
  h.document.getElementById("account").click();
  h.document.querySelector("#account-menu [data-view=faq]").click();
  assert.equal(h.text("#title"), "FAQ");
  assert.equal(h.text("#eyebrow"), "");
  assert.equal(h.all("#content .row b")[0]?.textContent, "What is Lore?");
  assert.ok(!h.document.getElementById("account-menu").hasAttribute("data-popover-open"), "the menu closes");
  assert.equal(h.document.getElementById("capture").hidden, true, "the composer is the Inbox's");
  h.call("show", "inbox");
  assert.doesNotMatch(h.text("#content"), /Who buys|Getting paid/);
  h.call("show", "settings");
  assert.doesNotMatch(h.text("#content"), /Who buys|Getting paid/);
});
