// APP-266: support/views.json says which walks' shot() calls run the layout scan on which view, at which widths. This
// keeps that table and the code it describes in step: every shot(label) in support/edge.cjs has a row, every label in
// the table is still in edge.cjs, every walk a row names is one support/walks.cjs runs, every dead scenario is one
// walks.cjs does not run and edge.cjs still has (APP-265 deleted listing and extras; firstrun stays under dead because
// it is run by hand, never by CI), and the widths agree with edge.cjs's NARROW set and src/main.cjs's window. Nothing here lays anything out: the scan itself needs
// Electron, and only a shot() under edge.sh counts as a layout check. XC-108 adds the guard at the end: each row's walk
// still reaches, in edge.cjs's scenario branches, every shot() the row lists.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const desktop = join(__dirname, "..", "..");
const edge = readFileSync(join(desktop, "support", "edge.cjs"), "utf8");
const walksSource = readFileSync(join(desktop, "support", "walks.cjs"), "utf8");
const mainSource = readFileSync(join(desktop, "src", "main.cjs"), "utf8");
/** @type {{ window: { width: number }, narrow: { width: number, walks: string[] }, dark: { walks: string[], shots: string[] }, views: { id: string, scans: { walk: string, widths: number[], shots: string[] }[] }[], dead: { scenarios: { scenario: string, views: Record<string, string[]> }[] } }} */
const table = JSON.parse(readFileSync(join(desktop, "support", "views.json"), "utf8"));

/** Every label a shot() call in edge.cjs (or in `source`, a piece of it) can produce. A template label with
 * `${X ? "a" : "b"}` produces both. */
const edgeLabels = (source = edge) => {
  const labels = new Set();
  for (const match of source.matchAll(/\bshot\(\s*(?:"([^"]*)"|`([^`]*)`)\s*\)/g)) {
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

/** XC-108: the shot() labels each scenario reaches in `source`. edge.cjs picks a walk's steps with if / else if / else
 * chains on the scenario, one statement per line: `if (scenario === "store") {`, `} else if (["a", "b"].includes(scenario))
 * {`, `} else {`, closed by a `}` at the chain's own indent. A branch runs the scenarios its condition names; an `else`,
 * or an `else if` on something other than the scenario, runs every scenario of `universe` its chain has not named yet.
 * A shot() inside no such branch is reached by every scenario. Read statically, so a shot() behind some other condition
 * (DARK, a check that failed) still counts as reached: this follows where a shot() sits, not whether it ran.
 * @param {string} source @param {Set<string>} universe @returns {Map<string, Set<string>>} */
const reach = (source, universe) => {
  const named = (/** @type {string} */ condition) => [...condition.matchAll(/scenario\s*===\s*"([^"]+)"/g)].map((match) => match[1]).concat([...condition.matchAll(/\[((?:"[^"]+",?\s*)+)\]\.includes\(scenario\)/g)].flatMap((match) => [...match[1].matchAll(/"([^"]+)"/g)].map((name) => name[1])));
  /** @type {{ indent: string, chain: Set<string>, runs: Set<string> }[]} the scenario branches open at this line */
  const open = [];
  /** @type {Map<string, Set<string>>} */
  const reached = new Map([...universe].map((scenario) => [scenario, new Set()]));
  for (const line of source.split("\n")) {
    const top = open.at(-1);
    const branch = /^(\s*)(\} else )?if \((.*)\) \{\s*$/.exec(line);
    const otherwise = /^(\s*)\} else \{\s*$/.exec(line);
    const close = /^(\s*)\}\s*$/.exec(line);
    if (branch && /scenario\s*===|\.includes\(scenario\)/.test(branch[3])) {
      assert.doesNotMatch(branch[3], /scenario\s*!==|!\s*\[/, `a scenario branch this test cannot read: ${line.trim()}`);
      const names = named(branch[3]);
      if (branch[2]) {
        assert.ok(top && top.indent === branch[1], `an else if on the scenario with no chain open at its indent: ${line.trim()}`);
        for (const name of names) top.chain.add(name);
        top.runs = new Set(names);
      } else open.push({ indent: branch[1], chain: new Set(names), runs: new Set(names) });
    } else if ((otherwise || (branch && branch[2])) && top && top.indent === (otherwise ?? branch)?.[1]) {
      top.runs = new Set([...universe].filter((scenario) => !top.chain.has(scenario)));
    } else if (close && top && top.indent === close[1]) {
      open.pop();
    } else {
      for (const label of edgeLabels(line)) for (const [scenario, labels] of reached) if (open.every((at) => at.runs.has(scenario))) labels.add(label);
    }
  }
  return reached;
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

// XC-108: the view-table guard. Every row's walk still reaches each shot() the row lists, so a view cannot stop being
// scanned by the walk the table names unless the table is edited in the same diff. Deleting a shot() also fails "every
// label in views.json is still a shot()"; moving one into another walk's branch, or out of one walk while another still
// shoots the label, fails only here. The widths a row names follow from its walk (shot() scans every NARROW walk at
// both widths), which "widths follow edge.cjs's NARROW set" holds, so a reached label is scanned at the row's widths.
test("every row's walk still reaches the shots it lists, so no view loses its scan without an edit here", () => {
  const universe = new Set([...walks().keys(), ...scenarios(), ...table.dead.scenarios.map((dead) => dead.scenario)]);
  const reached = reach(edge, universe);
  const lost = [];
  for (const view of table.views) for (const scan of view.scans) for (const label of scan.shots) {
    if (!reached.get(scan.walk)?.has(label)) lost.push(`${view.id}: ${scan.walk} no longer shoots ${label}`);
  }
  for (const dead of table.dead.scenarios) for (const [view, labels] of Object.entries(dead.views)) for (const label of labels) {
    if (!reached.get(dead.scenario)?.has(label)) lost.push(`dead ${dead.scenario}/${view}: ${dead.scenario} no longer shoots ${label}`);
  }
  assert.deepEqual(lost, [], `views.json says these are scanned, but edge.cjs no longer shoots them in that walk; edit support/views.json in the same diff to say so: ${lost.join("; ")}`);
});

test("would notice: a shot() moved to another walk's branch, an else branch, and a shot() outside every branch", () => {
  const source = [
    `const seed = 1;`,
    `if (scenario === "a") {`,
    `  seed();`,
    `}`,
    `async function walk() {`,
    `  await shot("everyone");`,
    `  if (scenario === "a") {`,
    `    await shot("a-only");`,
    `    if (DARK) {`,
    "      await shot(`a-${DARK ? \"dark\" : \"light\"}`);",
    `    }`,
    `  } else if (["b", "c"].includes(scenario)) {`,
    `    await shot("b-or-c");`,
    `  } else if (scenario === "d" || scenario === "e") {`,
    `    await shot("d-or-e");`,
    `  } else {`,
    `    await shot("the-rest");`,
    `  }`,
    `}`
  ].join("\n");
  const universe = new Set(["a", "b", "c", "d", "e", "f"]);
  const of = (/** @type {Map<string, Set<string>>} */ reached, /** @type {string} */ scenario) => [...(reached.get(scenario) ?? [])].sort();
  const reached = reach(source, universe);
  assert.deepEqual(of(reached, "a"), ["a-dark", "a-light", "a-only", "everyone"]);
  assert.deepEqual(of(reached, "b"), ["b-or-c", "everyone"]);
  assert.deepEqual(of(reached, "e"), ["d-or-e", "everyone"]);
  assert.deepEqual(of(reached, "f"), ["everyone", "the-rest"]);
  const moved = reach(source.replace(`    await shot("a-only");\n`, "").replace(`await shot("b-or-c");`, `await shot("b-or-c");\n    await shot("a-only");`), universe);
  assert.deepEqual(of(moved, "a"), ["a-dark", "a-light", "everyone"], "a shot() moved out of a's branch is no longer a's");
  assert.deepEqual(of(moved, "c"), ["a-only", "b-or-c", "everyone"]);
});
