// XC-108: the walks' budget. support/walks.cjs may list at most seven walks, and their `seconds` may sum to at most
// 450, so the walks step stays the top of the pyramid and not its middle. A PR that needs more says so in walks.cjs
// itself, on one line of its own, naming the backlog item that allows it and the figures it allows:
//
//   // walks-budget: APP-123 allows 8 walks and 480 seconds: <why>
//
// The named item must be a file under docs/backlog/. The note's figures replace the defaults; they are not a blanket
// waiver, so a ninth walk or a further second still fails until the note is edited, and the diff shows that. A note
// whose figures the walks already fit under is reported (a diagnostic, not a failure) so it can be taken out.
// walks.cjs is a script that runs the walks as soon as it is loaded, so this reads its source, as views.test.cjs does.
const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");

const desktop = join(__dirname, "..", "..");
const BACKLOG = join(desktop, "..", "..", "docs", "backlog");
const DEFAULT = { walks: 7, seconds: 450 };
const NOTE = /^\/\/ walks-budget: (\S+) allows (\d+) walks and (\d+) seconds\b/gm;

/** Whether `id` is a backlog item: some docs/backlog/<component>/<id>-*.md. @param {string} id */
const isItem = (id) =>
  /^[A-Z]+-\d+$/.test(id) &&
  existsSync(BACKLOG) &&
  readdirSync(BACKLOG, { withFileTypes: true }).some(
    (folder) => folder.isDirectory() && readdirSync(join(BACKLOG, folder.name)).some((name) => name.startsWith(`${id}-`) && name.endsWith(".md"))
  );

/** The walks a walks.cjs source lists, with their seconds, and the budget it sets: the default, or its one note's.
 * @param {string} source @param {(id: string) => boolean} known */
const budget = (source, known) => {
  const list = /const WALKS = \[([\s\S]*?)\n\];/.exec(source);
  assert.ok(list, "walks.cjs lists WALKS");
  const walks = [...list[1].matchAll(/\{\s*name:\s*"([^"]+)"([^}]*)\}/g)].map((match) => {
    const seconds = /seconds:\s*(\d+)/.exec(match[2]);
    assert.ok(seconds, `walk ${match[1]} has a whole number of seconds`);
    return { name: match[1], seconds: Number(seconds[1]) };
  });
  assert.ok(walks.length > 0, "walks.cjs names at least one walk");
  const notes = [...source.matchAll(NOTE)];
  assert.ok(notes.length <= 1, `walks.cjs has ${notes.length} walks-budget notes; keep one`);
  const note = notes[0] && { item: notes[0][1], walks: Number(notes[0][2]), seconds: Number(notes[0][3]) };
  if (note) assert.ok(known(note.item), `the walks-budget note names ${note.item}, which is no backlog item under docs/backlog/`);
  return { walks, total: walks.reduce((sum, walk) => sum + walk.seconds, 0), limit: note ?? DEFAULT, note };
};

const HOW = "add or edit a `// walks-budget: <ITEM-ID> allows <N> walks and <S> seconds: <why>` line in support/walks.cjs, naming the item that allows it";

/** The budget's two rules, as failures. @param {ReturnType<typeof budget>} found */
const breaches = ({ walks, total, limit }) => [
  ...(walks.length > limit.walks ? [`walks.cjs lists ${walks.length} walks (${walks.map((walk) => walk.name).join(", ")}); the budget is ${limit.walks}`] : []),
  ...(total > limit.seconds ? [`the walks' seconds sum to ${total}; the budget is ${limit.seconds}`] : [])
];

const source = readFileSync(join(desktop, "support", "walks.cjs"), "utf8");

test("support/walks.cjs lists no more walks than its budget allows", () => {
  const found = budget(source, isItem);
  assert.ok(found.walks.length <= found.limit.walks, `walks.cjs lists ${found.walks.length} walks; the budget is ${found.limit.walks}. To allow more, ${HOW}.`);
});

test("support/walks.cjs's seconds sum to no more than its budget allows", (t) => {
  const found = budget(source, isItem);
  assert.ok(found.total <= found.limit.seconds, `the walks' seconds sum to ${found.total}; the budget is ${found.limit.seconds}. To allow more, ${HOW}.`);
  if (found.note && found.walks.length <= DEFAULT.walks && found.total <= DEFAULT.seconds) {
    t.diagnostic(`the walks fit the default budget (${found.walks.length} walks, ${found.total} s): the ${found.note.item} walks-budget note can come out`);
  }
});

test("would notice: an eighth walk or a sum past 450 fails without a note, and a note sets the figures instead", () => {
  const walks = (/** @type {number[]} */ seconds) => `const WALKS = [\n${seconds.map((s, i) => `  { name: "w${i}", seconds: ${s} },`).join("\n")}\n];`;
  const yes = () => true;
  assert.deepEqual(breaches(budget(walks([60, 60, 60, 60, 60, 60, 90]), yes)), []);
  assert.equal(breaches(budget(walks([10, 10, 10, 10, 10, 10, 10, 10]), yes)).length, 1, "an eighth walk");
  assert.equal(breaches(budget(walks([60, 60, 60, 60, 60, 60, 91]), yes)).length, 1, "451 seconds");
  const noted = `// walks-budget: APP-1 allows 8 walks and 480 seconds: for the test\n${walks([60, 60, 60, 60, 60, 60, 60, 60])}`;
  assert.deepEqual(breaches(budget(noted, yes)), [], "the note's figures hold");
  assert.equal(breaches(budget(noted.replace(/60 \},\n\]/, "61 },\n]"), yes)).length, 1, "a second past the note's figure still fails");
  assert.throws(() => budget(noted, () => false), /no backlog item/, "the note must name a real item");
  assert.throws(() => budget(`${noted}\n// walks-budget: APP-2 allows 9 walks and 600 seconds`, yes), /keep one/);
  assert.ok(isItem("XC-108"), "this item is found under docs/backlog/");
});
