// XC-097: the unit tier's one rule, held by a test: a file under test/unit/ starts no process. It never requires
// support/scratch.cjs (which builds a `uv run` CLI runtime for the component tests), never loads child_process, and
// never runs `uv`. The two tiers also partition the suite, so every test file under test/ is in unit/ or component/
// and `npm run test:unit` plus `npm run test:component` is `npm test`.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const { join, relative } = require("node:path");

const TEST = join(__dirname, "..");

/** Every file under `folder`, recursively, as paths relative to test/ with forward slashes.
 * @param {string} folder @returns {string[]} */
const files = (folder) =>
  readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(TEST, join(entry.parentPath, entry.name)).split("\\").join("/"))
    .sort();

/** What a unit test may not do: a pattern over its source, and why it fails. @type {Array<[RegExp, string]>} */
const FORBIDDEN = [
  [/require\(\s*["'][^"']*support\/scratch\.cjs["']\s*\)/, "requires support/scratch.cjs, which builds a `uv run` CLI runtime"],
  [/require\(\s*["'](?:node:)?child_process["']\s*\)/, "loads child_process; a unit test starts no process"],
  [/\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\(\s*["'`]uv["'`]/, "runs uv"]
];

/** @param {string} source */
const offences = (source) => FORBIDDEN.filter(([pattern]) => pattern.test(source)).map(([, why]) => why);

test("no test under test/unit/ requires support/scratch.cjs, loads child_process or runs uv", () => {
  const self = relative(TEST, __filename);
  const unit = files(join(TEST, "unit")).filter((file) => file !== self);
  assert.ok(unit.length > 0, "found no unit tests beside this one");
  const found = Object.fromEntries(unit.map((file) => [file, offences(readFileSync(join(TEST, file), "utf8"))]).filter(([, why]) => why.length));
  assert.deepEqual(found, {}, "a unit test starts no process: move it to test/component/, or take the process out");
});

test("every test file under test/ is a .cjs file in the unit or the component tier", () => {
  const stray = files(TEST).filter((file) => !/^(?:unit|component)\/.*\.cjs$/.test(file));
  assert.deepEqual(stray, [], "node --test would run it, but neither npm run test:unit nor test:component would");
});

test("the guard catches each thing it exists for, and nothing it does not", () => {
  assert.deepEqual(offences('const { CLI, readState } = require("../../support/scratch.cjs");'), [FORBIDDEN[0][1]]);
  assert.deepEqual(offences("require('../support/scratch.cjs');"), [FORBIDDEN[0][1]]);
  assert.deepEqual(offences('const { spawnSync } = require("node:child_process");'), [FORBIDDEN[1][1]]);
  assert.deepEqual(offences('const cp = require("child_process");'), [FORBIDDEN[1][1]]);
  assert.deepEqual(offences('const out = spawnSync("uv", ["run", "lore", "status"]);'), ["runs uv"]);
  assert.deepEqual(offences("execFile('uv', ['run']);"), ["runs uv"]);
  // A unit test may talk about uv, scratch folders or spawning, and may require anything else.
  assert.deepEqual(offences('assert.match(body, /`uv run pytest -q`/); const scratch = await mkdtemp("lore-"); require("node:fs");'), []);
  assert.deepEqual(offences('assert.deepEqual(world.handed, [], "nothing worth matching spawns no matcher");'), []);
  assert.deepEqual(offences('runInNewContext(preload, { require: (name) => (name === "electron" ? electron : require(name)) });'), []);
});
