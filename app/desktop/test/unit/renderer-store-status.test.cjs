// APP-183: the store's status and price, worked out once from the snapshot and shown the same everywhere. storeStatus()
// says how the store stands (Live / Online / Offline / Not set up) and whether it takes play money; storePrice() is the
// one price per piece, the owner's saved one first and what the store charges when nothing is saved. A live real-money
// store says "Test" nowhere; every price surface (Settings, the price sheet, the FAQ, Inventory's rows, a memory's side
// panel, the store-opened line, the card minimum and the buyer preview) shows the same number; a price not yet on the
// store is explained once, by the Address row's note; and no status text sits in code font.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const REAL = "eip155:8453";
const TEST = "eip155:84532";
const URL_ = "https://store.example/mcp";
const NOW = Date.now();

/** One memory with a draft from it, a piece on sale and, with `pending`, a piece approved but not on the store yet. */
const MEMORY = { id: 1, title: "Notarizing an Electron app without stapling surprises", project_label: "lore-mcp", status: "private", updated_at: new Date(NOW).toISOString(), sources: [{ kind: "capture", id: "capture", label: "You", mark: "pen", at: null }], arrival: 1 };
const PIECES = [
  { id: 1, public_id: "0000000000000000000000001", title: "Stapling a notarized app", topic: "notarizing", state: "approved", live: true, provenance: [1], updated_at: new Date(NOW).toISOString() },
  { id: 2, public_id: "0000000000000000000000002", title: "Signing .bin symlinks", topic: "signing", state: "approved", live: false, provenance: [1], updated_at: new Date(NOW).toISOString() }
];
const DRAFT = { title: "When stapling fails silently", teaser: "t", content: "c", kind: "claim", topic: "stapling", provenance: [1] };

/** A store from the snapshot's point of view. @param {{saved?: number | null, live?: number | null, network?: string | null, selling?: boolean, state?: string, pending?: boolean}} [o] */
function store({ saved = null, live = null, network = REAL, selling = true, state = "online", pending = true } = {}) {
  const items = pending ? PIECES : PIECES.slice(0, 1);
  return emptySnapshot({
    library: { counts: { private: 1 }, sources: [], items: [MEMORY] },
    publications: { counts: { active: items.length, revoked: 0 }, items },
    pricing: { publication_usd: saved, answer_usd: null, answer_enabled: false, free_copies: 0 },
    node: { url: URL_, agents: null, selling, store: "current", live: { state, network, payout: `0x${"a".repeat(40)}`, price_usd: live } }
  });
}

/** @param {Snapshot} snapshot */
async function app(snapshot) {
  const h = load();
  h.lore.answer("snapshot", snapshot);
  h.lore.answer("candidates", [DRAFT]);
  h.lore.answer("memory", { ...MEMORY, content: "What I learned.", project: "lore-mcp", source: "capture", source_path: "" });
  h.boot();
  await h.idle();
  return h;
}

/** @param {ReturnType<typeof load>} h @param {string} view */
async function go(h, view) {
  h.call("show", view);
  await h.idle();
  return h.text("#content");
}

const priceRow = (/** @type {ReturnType<typeof load>} */ h) => h.all("#content .row").find((row) => row.querySelector(".t b")?.textContent === "Price");
const yourStore = (/** @type {ReturnType<typeof load>} */ h) => h.all("#content section").find((node) => node.querySelector("h2")?.textContent === "Your store");
/** Inventory's piece, Draft and Pending rows, by what they say. @param {ReturnType<typeof load>} h */
function rows(h) {
  const all = h.all("#content .invrow");
  const by = (/** @type {string} */ title) => all.find((row) => row.querySelector(".say")?.textContent === title);
  return { piece: by(PIECES[0].title), pending: by(PIECES[1].title), draft: by(DRAFT.title) };
}

// storeStatus: the one place the store's standing is worked out.

/** [name, the snapshot's node, its label, its tone, whether it takes play money] */
const STATUSES = [
  ["open and selling on real money", store(), "Live", "ok", false],
  ["online for the owner's agents only", store({ selling: false }), "Online", "ok", false],
  ["on the test network", store({ network: TEST }), "Live", "ok", true],
  ["not answering", store({ state: "unreachable" }), "Offline", "attention", false],
  ["never gone live", store({ state: "not_configured", network: null }), "Not set up", "", false],
  ["on a network Lore doesn't know", store({ network: "eip155:1" }), "Live", "ok", false]
];

for (const [name, s, label, tone, testMoney] of STATUSES) {
  test(`storeStatus: a store ${name} is ${label}${testMoney ? ", on play money" : ""}`, () => {
    const h = load();
    assert.deepEqual(h.call("storeStatus", s), { label, tone, test: testMoney });
    assert.equal(h.call("nodeLabel", s.node), label, "nodeLabel says the same");
  });
}

// A live real-money store never shows "Test".

test("a live real-money store says Test nowhere: Inbox, Settings, Inventory, the FAQ and the workspace menu", async () => {
  const h = await app(store({ saved: 0.5, live: 0.5 }));
  for (const view of ["inbox", "settings", "inventory", "faq"]) {
    const text = await go(h, view);
    assert.ok(text.length > 0, `${view} drew`);
    assert.doesNotMatch(text, /\btest\b/i, `${view}: ${text}`);
  }
  h.call("renderAccount");
  assert.equal(h.text("#account-line"), "Signed in with Claude · Store live");
  assert.doesNotMatch(h.text("#account-line"), /\btest\b/i);
});

test("a store still on the test network, online for its agents only, offers real payments and previews as test", async () => {
  const h = await app(store({ network: TEST, selling: false, saved: 0.5, live: 0.5 }));
  await go(h, "settings");
  const row = h.all("#content .row").find((node) => node.querySelector(".t b")?.textContent === "Test payments");
  assert.ok(row, h.text("#content"));
  assert.ok([...row.querySelectorAll("button")].some((button) => button.textContent === "Switch to real payments"));
  await h.run("previewPage")({ title: "x" });
  assert.equal(h.lore.callsTo("preview").at(-1)?.args[0].store.test, true);
});

test("a real-money store previews as real money, and the preview survives no snapshot", async () => {
  const h = await app(store({ saved: 0.5, live: 0.5 }));
  await h.run("previewPage")({ title: "x" });
  assert.deepEqual({ ...h.lore.callsTo("preview").at(-1)?.args[0].store }, { priceUsd: 0.5, origin: URL_, test: false });
  h.set("snapshot", null);
  await h.run("previewPage")({ title: "x" });
  assert.deepEqual({ ...h.lore.callsTo("preview").at(-1)?.args[0].store }, { priceUsd: 0.01, origin: "https://your-store.yourlore.dev", test: false });
});

// Price shows the charged price wherever it appears.

/** [nothing saved, the store charging 0.05]: every surface says $0.05. */
test("nothing saved while the store charges $0.05: Settings, the sheet, the FAQ, Inventory, the side panel and the store-opened line say $0.05", async () => {
  const s = store({ saved: null, live: 0.05 });
  const h = await app(s);
  assert.equal(h.call("storePrice", s), 0.05);
  await go(h, "settings");
  const row = priceRow(h);
  assert.ok(row.textContent.includes("$0.05 per piece"), row.textContent);
  assert.ok(!row.textContent.includes("Not set"), row.textContent);
  const change = [...row.querySelectorAll("button")].find((button) => button.textContent === "Change");
  assert.ok(change, "Change, not Set a price");
  change.click();
  const field = h.document.querySelector("dialog.form-sheet[open] input[aria-label='Price per publication in US dollars']");
  assert.equal(field?.value, "0.05", "the sheet opens on what the store charges");
  h.call("closeSheet");
  assert.match(await go(h, "faq"), /Yours is \$0\.05 a publication/);
  await go(h, "inventory");
  const { piece, pending, draft } = rows(h);
  for (const [name, node] of [["piece", piece], ["Pending", pending], ["Draft", draft]]) {
    assert.ok(node, `${name} row: ${h.text("#content")}`);
    assert.ok(node.textContent.includes("$0.05"), `${name} row: ${node.textContent}`);
  }
  assert.ok(pending.textContent.includes("Pending") && draft.textContent.includes("Draft"));
  await h.run("openMemory")(1);
  await h.idle();
  assert.match(h.text("#content .page-side"), /Price\$0\.05/);
  assert.match(h.call("storeOpened", s), /on sale at \$0\.05 each\./);
});

test("saved $0.10 while the store still charges $0.05: every price says $0.10, and the old one is explained once, in the Address row", async () => {
  const s = store({ saved: 0.1, live: 0.05 });
  const h = await app(s);
  await go(h, "settings");
  assert.ok(priceRow(h).textContent.includes("$0.10 per piece"), priceRow(h).textContent);
  assert.doesNotMatch(priceRow(h).textContent, /still charges/);
  [...priceRow(h).querySelectorAll("button")].find((button) => button.textContent === "Change").click();
  assert.equal(h.document.querySelector("dialog.form-sheet[open] input[aria-label='Price per publication in US dollars']")?.value, "0.1");
  h.call("closeSheet");
  assert.match(await go(h, "faq"), /Yours is \$0\.10 a publication/);
  await go(h, "inventory");
  for (const node of Object.values(rows(h))) assert.ok(node?.textContent.includes("$0.10"), node?.textContent);
  await h.run("openMemory")(1);
  await h.idle();
  assert.match(h.text("#content .page-side"), /Price\$0\.10/);

  // With nothing approved waiting, the Address row's note is the stale price's.
  const settled = await app(store({ saved: 0.1, live: 0.05, pending: false }));
  await go(settled, "settings");
  const card = yourStore(settled)?.textContent ?? "";
  assert.equal(card.split("Your store still charges $0.05").length - 1, 1, card);
  const addr = settled.all("#content .row").find((row) => row.querySelector(".t b")?.textContent === "Address");
  assert.ok(addr?.textContent.includes("Your store still charges $0.05"), addr?.textContent);
});

test("no price saved and none on the store: Settings says Not set, and Inventory offers Set price with no price", async () => {
  const s = store({ saved: null, live: null });
  const h = await app(s);
  assert.equal(h.call("storePrice", s), null);
  await go(h, "settings");
  assert.ok(priceRow(h).textContent.includes("Not set"), priceRow(h).textContent);
  assert.ok([...priceRow(h).querySelectorAll("button")].some((button) => button.textContent === "Set a price"));
  await go(h, "inventory");
  for (const node of Object.values(rows(h))) {
    assert.ok(node?.querySelector("[aria-label='Set price'], [title='Set price']") || node?.textContent.includes("Set price"), node?.outerHTML);
    assert.doesNotMatch(node.textContent, /\$/, node.textContent);
  }
  assert.doesNotMatch(h.call("storeOpened", s), /\$/);
});

// No status text renders in code font.

test("no pill, chip, value, run state or workspace-menu line sits in code", async () => {
  const h = await app(store({ saved: 0.5, live: 0.5 }));
  h.call("renderAccount");
  for (const view of ["inbox", "settings", "inventory"]) {
    await go(h, view);
    const status = h.all(".pill, .chip, .value, .run-state, #account-line");
    assert.ok(status.length > 0, view);
    for (const node of status) assert.equal(node.closest("code"), null, `${view}: ${node.outerHTML}`);
  }
});

test("styles.css gives .mono, .pill, .chip, .value and .run-state no monospace font", () => {
  const css = readFileSync(join(__dirname, "..", "..", "src", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const font = /font-family\s*:\s*([^;]+)/.exec(body)?.[1] ?? "";
    if (!/mono/i.test(font)) continue;
    for (const selector of selectors.split(",")) {
      const last = selector.trim().split(/\s+|>|\+|~/).filter(Boolean).at(-1) ?? "";
      assert.doesNotMatch(last, /\.(mono|pill|chip|value|run-state)(?![\w-])/, `${selector.trim()} sets ${font.trim()}`);
    }
  }
});
