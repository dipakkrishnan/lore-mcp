// APP-060: what the app sends the CLI for a search, and what it accepts back from the sales ledger and the drafts.
// APP-272: a stand-in CLI in this process records its argv and prints a fixture, so nothing here starts a process.
const assert = require("node:assert/strict");
const { test } = require("node:test");
// Required before anything loads ../../src/state.cjs: scratch store and launch keys, and a CLI that is a function.
const { fakeCli } = require("../../support/fake-cli.cjs");
const { searchMemories, readSales, candidates, readGists } = require("../../src/state.cjs");

/** Run `body` against a stand-in CLI that prints `output`; hands back the argv of its last call, or null if it never ran.
 * @param {string} output @param {(home: string) => Promise<void>} body */
async function withCli(output, body) {
  const calls = fakeCli(() => ({ stdout: output }));
  await body("/lore-home");
  return calls.at(-1)?.args ?? null;
}

const HIT = { id: 3, title: "Price the first tier low", content: "A low first price gets the first ten buyers." };

test("a search that leaves no terms asks the CLI nothing", async () => {
  for (const query of ["", "   ", "\t\n", "-rf --all", "  --status=public  -v "]) {
    const argv = await withCli("[]", async (home) => assert.deepEqual(await searchMemories(home, query), []));
    assert.equal(argv, null, `${JSON.stringify(query)} ran the CLI`);
  }
});

test("a search drops every term that would read as an option and always asks for private memories, 30 at most", async () => {
  /** @type {unknown} */
  let found;
  const argv = await withCli(JSON.stringify([HIT]), async (home) => { found = await searchMemories(home, "  pricing -v\t--status public\ntiers "); });
  assert.deepEqual(argv, ["search", "pricing", "public", "tiers", "--status", "private", "--limit", "30", "--json"]);
  assert.deepEqual(found, [HIT], "the hits come back as the CLI printed them");
});

test("a search sends its first eight terms and no more", async () => {
  const argv = await withCli("[]", (home) => searchMemories(home, "a b c d e f g h i j").then(() => undefined));
  assert.deepEqual(argv, ["search", "a", "b", "c", "d", "e", "f", "g", "h", "--status", "private", "--limit", "30", "--json"]);
  const eight = await withCli("[]", (home) => searchMemories(home, "-x a b c d e f g h").then(() => undefined));
  assert.deepEqual(eight?.slice(1, 9), ["a", "b", "c", "d", "e", "f", "g", "h"], "a dropped term does not count toward the eight");
});

/** @type {Array<[string, (home: string) => Promise<unknown>, string[], RegExp]>} */
const LISTS = [
  ["sales", readSales, ["node", "sales", "--json"], /Lore returned unreadable sales/],
  ["drafts", candidates, ["publication", "candidates"], /Lore returned unreadable drafts/]
];
const SALE = { kind: "publication", item_id: "a1", title: "Demos beat decks", price_usd: 3, network: "stripe", payer: "", tx: "pi_1", sold_at: "2026-10-01T00:00:00Z" };
const DRAFT = { title: "Price the first tier low", teaser: "How to set a first price.", content: "Raise it once there are receipts.", kind: "claim", topic: "pricing", provenance: [2] };

for (const [what, read, args, refused] of LISTS) {
  test(`${what}: a well-formed list round-trips`, async () => {
    const rows = what === "sales" ? [SALE, { ...SALE, tx: "pi_2", refund_owed: true }] : [DRAFT];
    /** @type {unknown} */
    let got;
    const argv = await withCli(JSON.stringify(rows), async (home) => { got = await read(home); });
    assert.deepEqual(argv, args);
    assert.deepEqual(got, rows);
    await withCli("[]\n", async (home) => assert.deepEqual(await read(home), [], "an empty list is a list"));
  });

  test(`${what}: anything but a list of records is refused, not handed on`, async (t) => {
    const logged = t.mock.method(console, "error", () => {});
    for (const output of ["{}", "null", "\"x\"", "3", "[1]", "[null]", "[{}, \"x\"]", `{"rows": [${JSON.stringify(SALE)}]}`]) {
      await withCli(output, (home) => assert.rejects(read(home), refused, output));
    }
    assert.ok(logged.mock.calls.some((call) => String(call.arguments[0]).includes("[null]")), "the log says what came back");
    await withCli("Traceback (most recent call last):", (home) => assert.rejects(read(home), SyntaxError, "output that isn't JSON at all"));
  });
}

test("gists come back as the CLI printed them, and anything but an id-to-line map is refused", async () => {
  /** @type {unknown} */
  let read;
  const argv = await withCli(JSON.stringify({ 3: "A low first price gets the first ten buyers." }), async (home) => { read = await readGists(home); });
  assert.deepEqual(argv, ["memory", "gists"]);
  assert.deepEqual(read, { 3: "A low first price gets the first ten buyers." });
  for (const bad of ["[]", "null", JSON.stringify({ 3: { content: "x" } })]) {
    await withCli(bad, (home) => assert.rejects(readGists(home), /Lore returned unreadable gists/));
  }
});
