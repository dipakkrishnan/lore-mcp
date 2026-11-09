// APP-269: what the `obsidian` walk checked on Connectors, now on the loaded renderer with the CLI's answers faked: an
// app offered by name with its own mark and one Connect, its vault listed to pick rather than a path to type, the sheet
// closing once connected, Read again saying what it found, and Disconnect asking one plain question that names the vault
// and keeps its memories. Which vaults Obsidian knows, and what a connect and a read bring in, are the CLI's
// (tests/test_sources.py); choosing among two vaults, a refused change and the sheets' layout stay with the connectors
// walk.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { load, emptySnapshot } = require("../../support/renderer-harness.cjs");

/** The catalog's Obsidian, as lore/sources.py describes it. @type {SourceApp} */
const OBSIDIAN = { id: "obsidian", name: "Obsidian", what: "Your vaults and notes", unit: "vault", item: "note", kind: "folder", refresh: true, placeholder: "" };
const VAULT = "/Users/owner/Edge Vault";
/** @param {number} imported @returns {SourceEntry} */
const connected = (imported) => ({ name: "edge-vault", label: "Edge Vault", enabled: true, imported, kind: "folder", locator: VAULT, connector: "obsidian", refresh: true, state: "connected" });
/** @param {SourceEntry[]} sources */
const withSources = (sources) => emptySnapshot({ library: { counts: { private: sources.reduce((n, s) => n + s.imported, 0) }, sources, items: [] } });

async function connectors() {
  const h = load();
  h.lore.answer("sourceCatalog", [OBSIDIAN]);
  h.lore.answer("sourceChoices", [{ label: "Edge Vault", locator: VAULT, open: true }]);
  h.lore.answer("snapshot", withSources([]));
  h.boot();
  await h.idle();
  h.call("show", "connectors");
  await h.idle();
  return h;
}
const row = (/** @type {ReturnType<typeof load>} */ h) => h.all("#content .row").find((node) => node.querySelector("b")?.textContent === "Obsidian");
const sheet = (/** @type {ReturnType<typeof load>} */ h) => h.document.querySelector("dialog.sheet[open]");
const click = async (/** @type {ReturnType<typeof load>} */ h, /** @type {Element | null | undefined} */ node) => {
  assert.ok(node, "something to click");
  /** @type {HTMLElement} */ (node).click();
  await h.idle();
};
const buttonIn = (/** @type {Element | null} */ node, /** @type {string} */ label) => [...(node?.querySelectorAll("button") ?? [])].find((button) => button.textContent === label);

test("Obsidian is offered by name, with what Lore reads, its own mark and one Connect, in no jargon", async () => {
  const h = await connectors();
  const offered = row(h)?.textContent ?? "";
  assert.match(offered, /Your vaults and notes/);
  assert.match(offered, /Connect/);
  assert.doesNotMatch(offered, /folder|source|markdown/i);
  assert.equal(row(h)?.querySelector("img.logo")?.getAttribute("src"), "assets/obsidian.svg");
});

test("Connect lists the vault by name, with nothing to type, and waits for a choice; connecting closes the sheet and the row says what was kept", async () => {
  const h = await connectors();
  await click(h, row(h)?.querySelector("button"));
  const options = h.all("dialog.sheet[open] .form-option");
  assert.equal(options.length, 1);
  assert.match(options[0].textContent ?? "", /Edge Vault/);
  assert.equal(h.document.querySelector("dialog.sheet[open] input[type=url], dialog.sheet[open] input[type=text]"), null, "nothing to type");
  const primary = /** @type {HTMLButtonElement} */ (h.document.querySelector("dialog.sheet[open] .btn.primary"));
  assert.equal(primary.disabled, true, "Connect waits for a choice");
  h.lore.answer("connectSource", { ...connected(2), added: 2 });
  h.lore.answer("snapshot", withSources([connected(2)]));
  const radio = /** @type {HTMLInputElement} */ (options[0].querySelector("input"));
  radio.checked = true;
  radio.dispatchEvent(new h.window.Event("change"));
  assert.equal(primary.disabled, false);
  await click(h, primary);
  assert.deepEqual(JSON.parse(JSON.stringify(h.lore.callsTo("connectSource").map((call) => call.args[0]))), [{ connector: "obsidian", locator: VAULT }]);
  assert.equal(sheet(h), null, "the sheet closed on its own");
  assert.match(row(h)?.textContent ?? "", /Connected/);
  assert.match(row(h)?.textContent ?? "", /2 notes kept/);
});

test("Read again picks up a note written since, and says so; Disconnect asks one question naming the vault, then offers Obsidian again and keeps the memories", async () => {
  const h = await connectors();
  h.lore.answer("snapshot", withSources([connected(2)]));
  h.lore.emit({ type: "changed" });
  await h.idle();
  await click(h, row(h)?.querySelector("button"));
  h.lore.answer("readSource", [{ name: "edge-vault", label: "Edge Vault", connector: "obsidian", added: 1, updated: 0, unchanged: 2, errors: 0, state: "connected" }]);
  h.lore.answer("snapshot", withSources([connected(3)]));
  await click(h, buttonIn(sheet(h), "Read again"));
  assert.deepEqual(h.lore.callsTo("readSource").map((call) => call.args), [["edge-vault"]]);
  assert.match(row(h)?.textContent ?? "", /3 notes kept/);
  assert.match(h.text("#status"), /1 new note\./);
  await click(h, row(h)?.querySelector("button"));
  await click(h, buttonIn(sheet(h), "Disconnect"));
  assert.equal(sheet(h)?.getAttribute("aria-label"), "Disconnect Edge Vault?");
  assert.match(sheet(h)?.textContent ?? "", /stay in your library/);
  h.lore.answer("removeSource", { name: "edge-vault", removed: true, memories: { kept: 3 } });
  h.lore.answer("snapshot", withSources([]));
  await click(h, buttonIn(sheet(h), "Disconnect"));
  assert.deepEqual(h.lore.callsTo("removeSource").map((call) => call.args), [["edge-vault", true]], "keeping the memories");
  assert.equal(sheet(h), null);
  assert.match(row(h)?.textContent ?? "", /Your vaults and notes/, "Obsidian is offered again");
  assert.match(h.text("#status"), /3 memories kept/);
});
