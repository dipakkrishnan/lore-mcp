// XC-080: a walk that fails is run once more, never a third time, and every retry is reported three ways.
// support/walks.cjs is run for real against a stand-in edge.sh that fails on command, so no Electron starts here.
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, chmodSync, readdirSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const WALKS = join(__dirname, "..", "support", "walks.cjs");
// Counts attempts per walk and appearance with mkdir, which is atomic, so two walks side by side never share a count.
const FAKE = `#!/bin/bash
key="$1-\${LORE_EDGE_APPEARANCE:-light}"
n=1
while ! mkdir "$FAKE_DIR/$key.$n" 2>/dev/null; do n=$((n + 1)); done
echo "attempt $n of $key"
case " $FAKE_FAIL_ONCE " in *" $1 "*) if [ "$n" = 1 ]; then echo "FAIL $1 boom"; exit 1; fi;; esac
case " $FAKE_FAIL_ALWAYS " in *" $1 "*) echo "FAIL $1 boom"; exit 1;; esac
echo "PASS ok"
`;

/** @param {string[]} names @param {Record<string, string>} env @param {{ ci?: boolean }} [options] */
const walk = (names, env, { ci = true } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "lore-walks-test-"));
  const edge = join(dir, "edge.sh");
  writeFileSync(edge, FAKE);
  chmodSync(edge, 0o755);
  const summary = join(dir, "summary.md");
  writeFileSync(summary, "");
  const childEnv = { ...process.env, LORE_WALKS_EDGE: edge, FAKE_DIR: dir, GITHUB_STEP_SUMMARY: summary, FAKE_FAIL_ONCE: "", FAKE_FAIL_ALWAYS: "", ...env };
  if (ci) childEnv.GITHUB_ACTIONS = "1";
  else delete childEnv.GITHUB_ACTIONS;
  // Output is kept, never re-echoed: a `::error` line printed by this test would become a real annotation on `npm test`.
  const result = spawnSync(process.execPath, [WALKS, "--jobs", "2", ...names], { env: childEnv, encoding: "utf8", timeout: 60_000 });
  const attempts = /** @type {Record<string, number>} */ ({});
  for (const entry of readdirSync(dir)) {
    const match = /^(.+)\.(\d+)$/.exec(entry);
    if (match) attempts[match[1]] = Math.max(attempts[match[1]] ?? 0, Number(match[2]));
  }
  const table = readFileSync(summary, "utf8");
  rmSync(dir, { recursive: true, force: true });
  return { code: result.status, out: result.stdout, err: result.stderr, table, attempts };
};

// `jobs` and `provision` are light walks with no appearance of their own; `faq` is the one launched dark (APP-247).
test("walks that pass first time are run once and the summary says no walk was retried", () => {
  const { code, out, table, attempts } = walk(["jobs", "provision"], {});
  assert.equal(code, 0, out);
  assert.deepEqual(attempts, { "jobs-light": 1, "provision-light": 1 });
  assert.match(out, /::group::PASS jobs \(\d+s, load [\d.]+\)\n/);
  assert.doesNotMatch(out, /::warning|::error|retrying|on retry \(/);
  assert.match(table, /^### Desktop walks\n/);
  assert.match(table, /\| jobs \| pass \| \d+s \|/);
  assert.match(table, /2\/2 walks passed in \d+s, 2 at a time\.\n0 of 2 walks passed on retry\.\n$/);
});

test("a walk that fails then passes is retried once, leaves the step green, and is reported three ways", () => {
  const { code, out, table, attempts } = walk(["jobs", "provision"], { FAKE_FAIL_ONCE: "jobs" });
  assert.equal(code, 0, out);
  assert.deepEqual(attempts, { "jobs-light": 2, "provision-light": 1 });
  const first = out.indexOf("::group::FAIL jobs (");
  const second = out.indexOf("::group::PASS jobs on retry (");
  assert.ok(first >= 0 && second > first, "the first attempt's FAIL group comes before the retry's PASS group");
  assert.match(out, /::group::FAIL jobs \(\d+s, load [\d.]+\), retrying\nattempt 1 of jobs-light\nFAIL jobs boom\n::endgroup::\n/);
  assert.match(out, /::group::PASS jobs on retry \(\d+s, load [\d.]+\)\nattempt 2 of jobs-light\nPASS ok\n::endgroup::\n::warning title=jobs passed on retry::FAIL jobs boom\n/);
  assert.doesNotMatch(out, /::error/);
  assert.match(table, /\| jobs \| pass \(retry\) \| \d+s \+ \d+s \|/);
  assert.match(table, /\| provision \| pass \| \d+s \|/);
  assert.match(table, /2\/2 walks passed in \d+s, 2 at a time\.\n1 of 2 walks passed on retry\.\n$/);
});

test("a walk that fails twice fails the step with both attempts' logs, an error annotation and a FAIL row, and no third try", () => {
  const { code, out, table, attempts } = walk(["jobs", "provision"], { FAKE_FAIL_ALWAYS: "jobs" });
  assert.equal(code, 1);
  assert.deepEqual(attempts, { "jobs-light": 2, "provision-light": 1 });
  assert.equal(out.match(/::group::FAIL jobs/g)?.length, 2);
  assert.match(out, /::group::FAIL jobs on retry \(\d+s, load [\d.]+\)\nattempt 2 of jobs-light\nFAIL jobs boom\n::endgroup::\n::error title=jobs walk failed::Failed twice\. Open the "FAIL jobs" groups in this step's log\.\n/);
  assert.doesNotMatch(out, /::warning/);
  assert.match(table, /\| jobs \| \*\*FAIL\*\* \| \d+s \+ \d+s \|/);
  assert.match(table, /1\/2 walks passed in \d+s, 2 at a time\.\n0 of 2 walks passed on retry\.\n$/);
});

test("a walk with an appearance is launched with it on every attempt and reported under its full label", () => {
  const { code, out, table, attempts } = walk(["connectors", "faq"], { FAKE_FAIL_ONCE: "faq" });
  assert.equal(code, 0, out);
  assert.deepEqual(attempts, { "connectors-light": 1, "faq-dark": 2 });
  assert.match(out, /::group::FAIL faq \(dark\) \(\d+s, load [\d.]+\), retrying\nattempt 1 of faq-dark\n/);
  assert.match(out, /::warning title=faq \(dark\) passed on retry::FAIL faq boom\n/);
  assert.match(table, /\| connectors \| pass \| \d+s \|/);
  assert.match(table, /\| faq \(dark\) \| pass \(retry\) \| \d+s \+ \d+s \|/);
  assert.match(table, /1 of 2 walks passed on retry\.\n$/);
});

test("outside CI the same run prints plain headings and no workflow commands", () => {
  const { code, out } = walk(["jobs"], { FAKE_FAIL_ONCE: "jobs" }, { ci: false });
  assert.equal(code, 0, out);
  assert.match(out, /\n== FAIL jobs \(\d+s, load [\d.]+\), retrying\n/);
  assert.match(out, /\n== PASS jobs on retry \(\d+s, load [\d.]+\)\n/);
  assert.doesNotMatch(out, /::/);
  assert.match(out, /1 of 1 walks passed on retry\.\n$/);
});
