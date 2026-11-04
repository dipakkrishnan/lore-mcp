// APP-266: support/views.json says which walks' shot() calls run the layout scan on which view, at which widths. This
// keeps that table and the code it describes in step: every shot(label) in support/edge.cjs has a row, every label in
// the table is still in edge.cjs, every walk a row names is one support/walks.cjs runs, every dead scenario is one
// walks.cjs does not run (and still exists in edge.cjs, so APP-265 empties the list as it deletes them), and the widths
// agree with edge.cjs's NARROW set and src/main.cjs's window. Nothing here lays anything out: the scan itself needs
// Electron, and only a shot() under edge.sh counts as a layout check.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const desktop = join(__dirname, "..");
const edge = readFileSync(join(desktop, "support", "edge.cjs"), "utf8");
const walksSource = readFileSync(join(desktop, "support", "walks.cjs"), "utf8");
const mainSource = readFileSync(join(desktop, "src", "main.cjs"), "utf8");
/** @type {{ window: { width: number }, narrow: { width: number, walks: string[] }, dark: { walks: string[], shots: string[] }, views: { id: string, scans: { walk: string, widths: number[], shots: string[] }[] }[], dead: { scenarios: { scenario: string, views: Record<string, string[]> }[] } }} */
const table = JSON.parse(readFileSync(join(desktop, "support", "views.json"), "utf8"));

/** Every label a shot() call in edge.cjs can produce. A template label with `${X ? "a" : "b"}` produces both. */
const edgeLabels = () => {
  const labels = new Set();
  for (const match of edge.matchAll(/\bshot\(\s*(?:"([^"]*)"|`([^`]*)`)\s*\)/g)) {
    let forms = [match[1] ?? match[2]];
    for (let branch = /\$\{[^}]*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*\}/.exec(forms[0]); branch; branch = /\$\{[^}]*\?\s*"([^"]*)"\s*:\s*"([^"]*)"\s*\}/.exec(forms[0])) {
      forms = forms.flatMap((form) => [form.replace(branch[0], branch[1]), form.replace(branch[0], branch[2])]);
    }
    for (const form of forms) {
      assert.doesNotMatch(form, /\$\{/, `a shot() label this test cannot expand: ${match[0]}`);
      labels.add(form);
    }
  }
  return labels;
};

/** The walks walks.cjs runs, by name, with the appearance each is launched in. */
const walks = () => {
  const list = /const WALKS = \[([\s\S]*?)\n\];/.exec(walksSource);
  assert.ok(list, "walks.cjs lists WALKS");
  const found = new Map();
  for (const match of list[1].matchAll(/\{\s*name:\s*"([^"]+)"([^}]*)\}/g)) found.set(match[1], /appearance:\s*"dark"/.test(match[2]) ? "dark" : "light");
  assert.ok(found.size > 0, "walks.cjs names at least one walk");
  return found;
};

/** The scenario names edge.cjs branches on. */
const scenarios = () => new Set([...edge.matchAll(/scenario\s*===\s*"([^"]+)"/g)].map((match) => match[1]).concat([...edge.matchAll(/\[((?:"[^"]+",?\s*)+)\]\.includes\(scenario\)/g)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((name) => name[1]))));

const narrow = () => {
  const set = /const NARROW = new Set\(\[([^\]]*)\]\)/.exec(edge);
  const width = /const NARROW_WIDTH = (\d+);/.exec(edge);
  assert.ok(set && width, "edge.cjs defines NARROW and NARROW_WIDTH");
  return { walks: new Set([...set[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])), width: Number(width[1]) };
};

const tableLabels = () => {
  /** @type {Map<string, string[]>} label → the rows naming it */
  const where = new Map();
  const file = (/** @type {string} */ label, /** @type {string} */ row) => where.set(label, [...(where.get(label) ?? []), row]);
  for (const view of table.views) for (const scan of view.scans) for (const label of scan.shots) file(label, `${view.id}/${scan.walk}`);
  for (const dead of table.dead.scenarios) for (const [view, labels] of Object.entries(dead.views)) for (const label of labels) file(label, `dead ${dead.scenario}/${view}`);
  return where;
};

test("every shot() label in edge.cjs has a row in views.json", () => {
  const rows = tableLabels();
  const missing = [...edgeLabels()].filter((label) => !rows.has(label));
  assert.deepEqual(missing, [], `shot() labels with no row: ${missing.join(", ")}`);
});

test("every label in views.json is still a shot() in edge.cjs", () => {
  const live = edgeLabels();
  const stale = [...tableLabels()].filter(([label]) => !live.has(label)).map(([label, rows]) => `${label} (${rows.join(", ")})`);
  assert.deepEqual(stale, [], `rows for labels edge.cjs no longer shoots: ${stale.join("; ")}`);
});

test("every live row names a walk walks.cjs runs, and a view a dead label is filed under exists", () => {
  const known = walks();
  const views = new Set(table.views.map((view) => view.id));
  for (const view of table.views) for (const scan of view.scans) assert.ok(known.has(scan.walk), `${view.id} names ${scan.walk}, which walks.cjs does not run`);
  for (const dead of table.dead.scenarios) for (const view of Object.keys(dead.views)) assert.ok(views.has(view), `dead ${dead.scenario} is filed under ${view}, which is no view in the table`);
});

test("a dead scenario is one edge.cjs has and walks.cjs does not run", () => {
  const known = walks();
  const branches = scenarios();
  for (const dead of table.dead.scenarios) {
    assert.ok(!known.has(dead.scenario), `${dead.scenario} is under dead but walks.cjs runs it: move its labels to live rows`);
    assert.ok(branches.has(dead.scenario), `${dead.scenario} is under dead but edge.cjs no longer has it: take it out of the list`);
  }
});

test("widths follow edge.cjs's NARROW set and main.cjs's window", () => {
  const known = walks();
  const { walks: narrowWalks, width } = narrow();
  const window = /function createWindow\(\) \{\s*window = new BrowserWindow\(\{\s*width: (\d+),/.exec(mainSource);
  assert.ok(window, "main.cjs opens the window at a fixed width");
  assert.equal(table.window.width, Number(window[1]), "views.json's window width is main.cjs's");
  assert.equal(table.narrow.width, width, "views.json's narrow width is edge.cjs's NARROW_WIDTH");
  assert.deepEqual(new Set(table.narrow.walks), new Set([...narrowWalks].filter((walk) => known.has(walk))), "views.json's narrow walks are NARROW's, less the dead scenarios");
  for (const view of table.views) for (const scan of view.scans) {
    const expected = narrowWalks.has(scan.walk) ? [table.window.width, width] : [table.window.width];
    assert.deepEqual(scan.widths, expected, `${view.id}/${scan.walk} scans at ${expected.join(" and ")} px`);
  }
});

test("dark walks are the ones walks.cjs launches dark", () => {
  const known = walks();
  assert.deepEqual(new Set(table.dark.walks), new Set([...known].filter(([, appearance]) => appearance === "dark").map(([name]) => name)));
  const rows = tableLabels();
  for (const label of table.dark.shots) assert.ok(rows.has(label), `dark shot ${label} has no row`);
});
