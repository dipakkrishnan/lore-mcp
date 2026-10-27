// Runs the renderer walks (support/edge.sh), several at a time. Each walk already keeps its own Lore home, Electron
// profile, store and ports, so walks side by side cannot see each other.
// Usage: node support/walks.cjs [--jobs N] [name ...]
//   --jobs N    walks at once (default 2: on a three-core macos-14 runner two side by side take as long as one
//               alone; a third slows each walk two to two and a half times and fails a third of them)
//   name ...    run only these walks
// XC-077: this list is the one CI runs and `npm run test:edge` runs. `seconds` is the walk's time alone on a CI runner
// (Oct 2026); it only orders the queue, longest first, so a rough figure is fine.
// XC-080: a walk that fails is run once more, after everything still waiting, and never a third time. A walk that
// passes on retry leaves the step green but is reported three ways: both attempts' log groups, a ::warning annotation
// naming the walk, and a `pass (retry)` row with a `K of N walks passed on retry` line in the step summary. The summary
// line is the count to trust (GitHub shows at most ten warnings per step). XC-072 counts a pass on retry as a flake: the
// number it drives down is that line, not the job's colour.
// LORE_WALKS_EDGE points at another script in place of edge.sh; test/walks.test.cjs uses it.
const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const { loadavg } = require("node:os");
const { join } = require("node:path");

/** @type {{ name: string, seconds: number, appearance?: string }[]} */
const WALKS = [
  { name: "agents", seconds: 215 },
  { name: "automations", seconds: 96 },
  { name: "connectors", seconds: 55 },
  { name: "connectors", appearance: "dark", seconds: 55 },
  { name: "store", seconds: 52 },
  { name: "checkin", seconds: 46 },
  { name: "fresh", seconds: 45 },
  { name: "today", seconds: 43 },
  { name: "settings", seconds: 40 },
  { name: "seller", seconds: 38 },
  { name: "cards", seconds: 37 },
  { name: "schedule", seconds: 31 },
  { name: "reading", seconds: 25 },
  { name: "quiet", seconds: 25 },
  { name: "update", seconds: 24 },
  { name: "feedback", seconds: 21 },
  { name: "sales", seconds: 20 },
  { name: "obsidian", seconds: 20 },
  { name: "sell", seconds: 14 },
  { name: "jobs", seconds: 13 },
  { name: "faq", seconds: 10 },
  { name: "provision", seconds: 8 },
];
// Past edge.sh's own watchdog (six minutes for agents), so a walk that hangs somewhere it does not watch still ends.
const LIMIT_MS = 8 * 60_000;
const EDGE = process.env.LORE_WALKS_EDGE || join(__dirname, "edge.sh");

const label = (/** @type {typeof WALKS[number]} */ walk) => (walk.appearance ? `${walk.name} (${walk.appearance})` : walk.name);
const args = process.argv.slice(2);
const option = (/** @type {string} */ flag) => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args.splice(at, 2)[1];
};
const jobs = Number(option("--jobs") ?? 2);
if (!(jobs >= 1)) {
  console.error("usage: node support/walks.cjs [--jobs N] [name ...]");
  process.exit(2);
}
const unknown = args.filter((name) => !WALKS.some((walk) => walk.name === name));
if (unknown.length) {
  console.error(`no such walk: ${unknown.join(", ")}`);
  process.exit(2);
}

// Longest first, so the long walks start at once and the short ones fill in behind them.
const queue = [...WALKS].sort((a, b) => b.seconds - a.seconds).filter((walk) => !args.length || args.includes(walk.name));

const ci = Boolean(process.env.GITHUB_ACTIONS);
// A workflow command's message is one line; GitHub reads these three characters as its own syntax.
const escape = (/** @type {string} */ text) => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
/** @typedef {{ ok: boolean, code: number | null, seconds: number, load: number, output: string }} Attempt */
/** @type {Map<string, { attempts: Attempt[] }>} */
const results = new Map(queue.map((walk) => [label(walk), { attempts: [] }]));

/** @param {typeof WALKS[number]} walk @returns {Promise<Attempt>} */
const attempt = (walk) =>
  new Promise((done) => {
    const started = Date.now();
    const env = { ...process.env, ...(walk.appearance ? { LORE_EDGE_APPEARANCE: walk.appearance } : {}) };
    // Its own process group, so a walk past its limit is stopped along with every server it started.
    const child = spawn(EDGE, [walk.name], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const limit = setTimeout(() => {
      output += `\nFAIL ${label(walk)} still running after ${LIMIT_MS / 60_000} minutes; stopped\n`;
      try {
        process.kill(-(/** @type {number} */ (child.pid)), "SIGKILL");
      } catch {}
    }, LIMIT_MS);
    child.on("close", (code) => {
      clearTimeout(limit);
      done({ ok: code === 0, code, seconds: Math.round((Date.now() - started) / 1000), load: loadavg()[0], output });
    });
  });

/** The line that says what went wrong: the first FAIL or ERROR line, else the last line said, else the exit code. */
const reason = (/** @type {Attempt} */ result) => {
  const lines = result.output.split("\n").filter((line) => line.trim());
  return lines.find((line) => /^(FAIL|ERROR)/.test(line)) ?? lines.at(-1) ?? `exit code ${result.code}`;
};

/** @param {typeof WALKS[number]} walk @param {number} attempts */
const run = async (walk, attempts) => {
  const result = await attempt(walk);
  const name = label(walk);
  const record = /** @type {{ attempts: Attempt[] }} */ (results.get(name));
  record.attempts.push(result);
  // One walk's output stays together, printed when it ends, rather than interleaved with its neighbours'.
  const retrying = !result.ok && attempts === 1;
  const heading = `${result.ok ? "PASS" : "FAIL"} ${name}${attempts > 1 ? " on retry" : ""} (${result.seconds}s, load ${result.load.toFixed(1)})${retrying ? ", retrying" : ""}`;
  console.log(ci ? `::group::${heading}` : `\n== ${heading}`);
  process.stdout.write(result.output.endsWith("\n") ? result.output : `${result.output}\n`);
  if (ci) console.log("::endgroup::");
  if (result.ok && attempts > 1 && ci) console.log(`::warning title=${name} passed on retry::${escape(reason(record.attempts[0]))}`);
  if (!result.ok && attempts > 1 && ci) console.log(`::error title=${name} walk failed::Failed twice. Open the "FAIL ${name}" groups in this step's log.`);
  return result.ok;
};

(async () => {
  const started = Date.now();
  console.log(`Walking ${queue.map(label).join(", ")} (${jobs} at a time)`);
  const pending = queue.map((walk) => ({ walk, attempts: 1 }));
  await Promise.all(Array.from({ length: Math.min(jobs, pending.length) }, async () => {
    for (let next = pending.shift(); next; next = pending.shift()) {
      const ok = await run(next.walk, next.attempts);
      // Once more, at the back of the queue, so a retry never delays a first attempt. Never a third time.
      if (!ok && next.attempts === 1) pending.push({ walk: next.walk, attempts: 2 });
    }
  }));
  const rows = [...results].map(([walk, { attempts }]) => ({ walk, ok: attempts.at(-1)?.ok ?? false, retried: attempts.length > 1, attempts }));
  const failed = rows.filter((row) => !row.ok);
  const retried = rows.filter((row) => row.ok && row.retried);
  const lines = [
    `| Walk | Result | Time |`,
    `|---|---|---|`,
    ...rows.map((row) => `| ${row.walk} | ${row.ok ? (row.retried ? "pass (retry)" : "pass") : "**FAIL**"} | ${row.attempts.map((a) => `${a.seconds}s`).join(" + ")} |`),
    ``,
    `${rows.length - failed.length}/${rows.length} walks passed in ${Math.round((Date.now() - started) / 1000)}s, ${jobs} at a time.`,
    `${retried.length} of ${rows.length} walks passed on retry.`,
  ];
  console.log(`\n${lines.join("\n")}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Desktop walks\n\n${lines.join("\n")}\n`);
  process.exit(failed.length ? 1 : 0);
})();
