// APP-270: what the `inventory` walk (APP-282, APP-289) checked of Inventory on a library shaped like a real one, now
// on the loaded renderer: seven memories from three places, a few days apart; pieces drafted one memory each; a piece
// taken down beside a live copy of itself; a store selling them. Inventory is one timeline, newest first, pieces and
// memories together, every row with where it came from and a date, and the taken-down piece out of the way in a folded
// group at the foot, never beside its live copy. What the store walk now checks live, because jsdom lays nothing out:
// a group header's weight and band and a row's 36px height, Inventory turned dark at once, and Record a memory opening
// its thread listening under Chromium's fake microphone (talking it through itself is renderer-talk.test.cjs). What
// Inventory looks like is the walks': views.json names the kept walk that scans each view.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

const DAY = 86_400_000;
const NOW = Date.now();
/** [title, project] in the order the seed captured them; the first is the newest, each three days older than the last. */
const KEPT = [
  ["Bonaire Open Water diving roll-up: lessons for a future Raja Ampat trip", "personal"],
  ["Travel: window seat on United or American; beach trips chosen for diving and poke", "personal"],
  ["Packing a dive kit for carry-on only", "personal"],
  ["Notarizing an Electron app without stapling surprises", "lore-mcp"],
  ["Code signing fails silently on .bin symlinks", "lore-mcp"],
  ["Auto-update from GitHub releases: three gotchas", "lore-mcp"],
  ["What the first three trial users got stuck on", "lore-mcp"]
];
/** Three places memories came from: the owner, an app and a routine. @type {MemorySource[]} */
const FROM = [
  { kind: "capture", id: "capture", label: "You", mark: "pen", at: null },
  { kind: "app", id: "obsidian", label: "Obsidian", mark: "obsidian", at: null },
  { kind: "routine", id: "synthesis", label: "Read connected apps", mark: "clock", at: null }
];
/** @type {MemoryItem[]} */
const MEMORIES = KEPT.map(([title, project], at) => ({ id: at + 1, title, project_label: project, status: "private", updated_at: new Date(NOW - 3 * at * DAY).toISOString(), sources: [FROM[at % 3]], arrival: at + 1 }));
const id = (/** @type {number} */ n) => `00000000000000000000000${n}`;
/** One piece per memory, as the seed drafted them: its topic is the memory's title. Ids grow in the seed's order.
 * @type {PublicationItem[]} */
const PIECES = [
  { id: 1, public_id: id(1), title: KEPT[0][0], topic: KEPT[0][0], state: "approved", live: true, provenance: [1], updated_at: new Date(NOW - 1 * DAY).toISOString() },
  { id: 2, public_id: id(2), title: KEPT[1][0], topic: KEPT[1][0], state: "revoked", live: false, provenance: [2], updated_at: new Date(NOW - 2 * DAY).toISOString() },
  { id: 3, public_id: id(3), title: KEPT[1][0], topic: KEPT[1][0], state: "approved", live: true, provenance: [2], updated_at: new Date(NOW - 4 * DAY).toISOString() },
  { id: 4, public_id: id(4), title: KEPT[3][0], topic: KEPT[3][0], state: "approved", live: true, provenance: [4], updated_at: new Date(NOW - 10 * DAY).toISOString() }
];
const library = () => emptySnapshot({
  library: { counts: { private: MEMORIES.length }, sources: [], items: MEMORIES },
  publications: { counts: { active: 3, revoked: 1 }, items: PIECES },
  pricing: { publication_usd: 1, answer_usd: null, answer_enabled: false, free_copies: 0 },
  node: { url: "https://store.example/mcp", agents: null, selling: true, store: "current", live: { state: "online", network: "eip155:84532", payout: `0x${"a".repeat(40)}`, price_usd: 1 } }
});

async function inventory() {
  const h = load();
  h.lore.answer("snapshot", library());
  h.boot();
  await h.idle();
  h.call("show", "inventory");
  await h.idle();
  return h;
}
const heads = (/** @type {ReturnType<typeof load>} */ h) => h.all("#content .igroup").map((g) => [g.querySelector(".label")?.textContent, g.getAttribute("aria-expanded")]);
const titles = (/** @type {ReturnType<typeof load>} */ h, /** @type {string} */ start) => h.all("#content .invrow .say").filter((say) => say.textContent?.startsWith(start));

test("Inventory is one list: the only group is Taken down, folded, at the foot", async () => {
  const h = await inventory();
  assert.equal(h.text("#title"), "Inventory");
  assert.deepEqual(heads(h), [["Taken down", "false"]]);
  const list = h.document.querySelector("#content .inv");
  assert.equal(list?.lastElementChild?.classList.contains("igroup"), true, "Taken down is the last thing in the list");
  assert.equal(h.all("#content .invrow[data-key^=piece], #content .invrow[data-key^=memory]").length, 7, "three live pieces and the four memories not sold on their own, the taken-down piece folded away");
});

test("rows are newest first, pieces and memories together", async () => {
  const h = await inventory();
  const rows = h.all("#content .invrow:is([data-key^=piece], [data-key^=memory])");
  const kinds = rows.map((row) => /** @type {HTMLElement} */ (row).dataset.key?.split(":")[0]);
  assert.ok(kinds.includes("piece") && kinds.includes("memory"), "one timeline, not a group per kind");
  const at = (/** @type {Element} */ row) => {
    const key = /** @type {HTMLElement} */ (row).dataset.key ?? "";
    const [kind, n] = key.split(":");
    const item = kind === "piece" ? PIECES.find((piece) => piece.id === Number(n)) : MEMORIES.find((memory) => memory.id === Number(n));
    return Date.parse(item?.updated_at ?? "");
  };
  const times = rows.map(at);
  assert.ok(times.every((time, n) => n === 0 || time <= times[n - 1]), JSON.stringify(rows.map((row) => /** @type {HTMLElement} */ (row).dataset.key)));
  assert.ok(rows.every((row) => row.querySelector(".age")?.textContent), "each row says its date");
});

test("a taken-down piece reads only in its group; its live copy, and a memory on sale on its own, read once", async () => {
  const h = await inventory();
  assert.ok(!h.all("#content .invrow .st").some((st) => st.textContent === "Taken down"), "no live row says Taken down");
  assert.equal(titles(h, "Travel: window seat").length, 1, "the live copy of the taken-down piece reads once");
  assert.equal(titles(h, "Travel: window seat")[0].closest(".invrow")?.querySelector(".st")?.textContent, "On sale");
  assert.equal(titles(h, "Bonaire").length, 1, "a memory on sale on its own reads once");
  assert.match(/** @type {HTMLElement} */ (titles(h, "Bonaire")[0].closest(".invrow")).dataset.key ?? "", /^piece:/, "…as its piece");
});

test("every piece and memory row shows where it came from and a date, and no title pops the browser's own tooltip", async () => {
  const h = await inventory();
  const rows = h.all("#content .invrow:is([data-key^=piece], [data-key^=memory])");
  assert.ok(rows.length > 0);
  for (const row of rows) {
    assert.ok(row.querySelector(".src .routine-mark"), `a mark on ${row.textContent}`);
    assert.ok(row.querySelector(".age")?.textContent, `a date on ${row.textContent}`);
  }
  assert.ok(!h.all("#content .invrow .say").some((say) => say.hasAttribute("title")));
});

test("Taken down opens to show what came off sale", async () => {
  const h = await inventory();
  /** @type {HTMLElement} */ (h.all("#content .igroup").at(-1)).click();
  await h.idle();
  assert.deepEqual(heads(h), [["Taken down", "true"]]);
  const down = h.all("#content .invrow .st").filter((st) => st.textContent === "Taken down");
  assert.equal(down.length, 1);
  assert.ok(down[0].closest(".invrow")?.querySelector(".say")?.textContent?.startsWith("Travel: window seat"));
  assert.equal(titles(h, "Travel: window seat").length, 2, "the live copy and, apart from it, the one taken down");
});
