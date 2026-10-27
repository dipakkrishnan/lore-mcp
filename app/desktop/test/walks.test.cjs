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

test("walks that pass first time are run once and the summary says no walk was retried", () => {
  const { code, out, table, attempts } = walk(["faq", "provision"], {});
  assert.equal(code, 0, out);
  assert.deepEqual(attempts, { "faq-light": 1, "provision-light": 1 });
  assert.match(out, /::group::PASS faq \(\d+s, load [\d.]+\)\n/);
  assert.doesNotMatch(out, /::warning|::error|retrying|on retry \(/);
  assert.match(table, /^### Desktop walks\n/);
  assert.match(table, /\| faq \| pass \| \d+s \|/);
  assert.match(table, /2\/2 walks passed in \d+s, 2 at a time\.\n0 of 2 walks passed on retry\.\n$/);
});

test("a walk that fails then passes is retried once, leaves the step green, and is reported three ways", () => {
  const { code, out, table, attempts } = walk(["faq", "provision"], { FAKE_FAIL_ONCE: "faq" });
  assert.equal(code, 0, out);
  assert.deepEqual(attempts, { "faq-light": 2, "provision-light": 1 });
  const first = out.indexOf("::group::FAIL faq (");
  const second = out.indexOf("::group::PASS faq on retry (");
  assert.ok(first >= 0 && second > first, "the first attempt's FAIL group comes before the retry's PASS group");
  assert.match(out, /::group::FAIL faq \(\d+s, load [\d.]+\), retrying\nattempt 1 of faq-light\nFAIL faq boom\n::endgroup::\n/);
  assert.match(out, /::group::PASS faq on retry \(\d+s, load [\d.]+\)\nattempt 2 of faq-light\nPASS ok\n::endgroup::\n::warning title=faq passed on retry::FAIL faq boom\n/);
  assert.doesNotMatch(out, /::error/);
  assert.match(table, /\| faq \| pass \(retry\) \| \d+s \+ \d+s \|/);
  assert.match(table, /\| provision \| pass \| \d+s \|/);
  assert.match(table, /2\/2 walks passed in \d+s, 2 at a time\.\n1 of 2 walks passed on retry\.\n$/);
});

test("a walk that fails twice fails the step with both attempts' logs, an error annotation and a FAIL row, and no third try", () => {
  const { code, out, table, attempts } = walk(["faq", "provision"], { FAKE_FAIL_ALWAYS: "faq" });
  assert.equal(code, 1);
  assert.deepEqual(attempts, { "faq-light": 2, "provision-light": 1 });
  assert.equal(out.match(/::group::FAIL faq/g)?.length, 2);
  assert.match(out, /::group::FAIL faq on retry \(\d+s, load [\d.]+\)\nattempt 2 of faq-light\nFAIL faq boom\n::endgroup::\n::error title=faq walk failed::Failed twice\. Open the "FAIL faq" groups in this step's log\.\n/);
  assert.doesNotMatch(out, /::warning/);
  assert.match(table, /\| faq \| \*\*FAIL\*\* \| \d+s \+ \d+s \|/);
  assert.match(table, /1\/2 walks passed in \d+s, 2 at a time\.\n0 of 2 walks passed on retry\.\n$/);
});

test("the light and dark connectors walks are retried and reported apart, each with its appearance", () => {
  const { code, out, table, attempts } = walk(["connectors"], { FAKE_FAIL_ONCE: "connectors" });
  assert.equal(code, 0, out);
  assert.deepEqual(attempts, { "connectors-light": 2, "connectors-dark": 2 });
  assert.match(out, /::warning title=connectors passed on retry::FAIL connectors boom\n/);
  assert.match(out, /::warning title=connectors \(dark\) passed on retry::FAIL connectors boom\n/);
  assert.match(table, /\| connectors \| pass \(retry\) \|/);
  assert.match(table, /\| connectors \(dark\) \| pass \(retry\) \|/);
  assert.match(table, /2 of 2 walks passed on retry\.\n$/);
});

test("outside CI the same run prints plain headings and no workflow commands", () => {
  const { code, out } = walk(["faq"], { FAKE_FAIL_ONCE: "faq" }, { ci: false });
  assert.equal(code, 0, out);
  assert.match(out, /\n== FAIL faq \(\d+s, load [\d.]+\), retrying\n/);
  assert.match(out, /\n== PASS faq on retry \(\d+s, load [\d.]+\)\n/);
  assert.doesNotMatch(out, /::/);
  assert.match(out, /1 of 1 walks passed on retry\.\n$/);
});
