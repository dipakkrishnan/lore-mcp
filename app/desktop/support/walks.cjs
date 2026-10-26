// Runs the renderer walks (support/edge.sh), several at a time. Each walk already keeps its own Lore home, Electron
// profile, clipboard and ports, so walks side by side cannot see each other.
// Usage: node support/walks.cjs [--jobs N] [--shard I/K] [name ...]
//   --jobs N    walks at once (default 2: on a three-core macos-14 runner two side by side take as long as one
//               alone; a third slows each walk two to two and a half times and fails a third of them)
//   --shard I/K run only the I-th of K shards, balanced by each walk's measured time
//   name ...    run only these walks
// XC-073: this list is the one CI runs and `npm run test:edge` runs. `seconds` is the walk's time alone on a CI runner
// (Oct 2026); it only balances shards and orders the queue, longest first, so a rough figure is fine.
const { spawn } = require("node:child_process");
const { appendFileSync } = require("node:fs");
const { loadavg } = require("node:os");
const { join } = require("node:path");

/** @type {{ name: string, seconds: number, appearance?: string }[]} */
const WALKS = [
  { name: "agents", seconds: 250 },
  { name: "automations", seconds: 90 },
  { name: "connectors", seconds: 55 },
  { name: "connectors", appearance: "dark", seconds: 55 },
  { name: "store", seconds: 55 },
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

const label = (/** @type {typeof WALKS[number]} */ walk) => (walk.appearance ? `${walk.name} (${walk.appearance})` : walk.name);
const args = process.argv.slice(2);
const option = (/** @type {string} */ flag) => {
  const at = args.indexOf(flag);
  return at < 0 ? undefined : args.splice(at, 2)[1];
};
const jobs = Number(option("--jobs") ?? 2);
const [index, count] = (option("--shard") ?? "1/1").split("/").map(Number);
if (!(jobs >= 1) || !(count >= 1) || !(index >= 1 && index <= count)) {
  console.error("usage: node support/walks.cjs [--jobs N] [--shard I/K] [name ...]");
  process.exit(2);
}
const unknown = args.filter((name) => !WALKS.some((walk) => walk.name === name));
if (unknown.length) {
  console.error(`no such walk: ${unknown.join(", ")}`);
  process.exit(2);
}

// Longest first into whichever shard has the least so far: each shard ends up within one short walk of the others.
const shards = Array.from({ length: count }, () => ({ seconds: 0, walks: /** @type {typeof WALKS} */ ([]) }));
for (const walk of [...WALKS].sort((a, b) => b.seconds - a.seconds)) {
  const lightest = shards.reduce((least, shard) => (shard.seconds < least.seconds ? shard : least));
  lightest.seconds += walk.seconds;
  lightest.walks.push(walk);
}
const queue = shards[index - 1].walks.filter((walk) => !args.length || args.includes(walk.name));

const ci = Boolean(process.env.GITHUB_ACTIONS);
/** @type {{ walk: string, ok: boolean, seconds: number, load: number }[]} */
const results = [];

/** @param {typeof WALKS[number]} walk */
const run = (walk) =>
  new Promise((done) => {
    const started = Date.now();
    const env = { ...process.env, ...(walk.appearance ? { LORE_EDGE_APPEARANCE: walk.appearance } : {}) };
    // Its own process group, so a walk past its limit is stopped along with every server it started.
    const child = spawn(join(__dirname, "edge.sh"), [walk.name], { env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
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
      const result = { walk: label(walk), ok: code === 0, seconds: Math.round((Date.now() - started) / 1000), load: loadavg()[0] };
      results.push(result);
      // One walk's output stays together, printed when it ends, rather than interleaved with its neighbours'.
      const heading = `${result.ok ? "PASS" : "FAIL"} ${result.walk} (${result.seconds}s, load ${result.load.toFixed(1)})`;
      console.log(ci ? `::group::${heading}` : `\n== ${heading}`);
      process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
      if (ci) console.log("::endgroup::");
      if (!result.ok && ci) console.log(`::error title=${result.walk} walk failed::Open the "FAIL ${result.walk}" group in this step's log.`);
      done(undefined);
    });
  });

(async () => {
  const started = Date.now();
  console.log(`Walking ${queue.map(label).join(", ")} (${jobs} at a time, shard ${index}/${count})`);
  const pending = [...queue];
  await Promise.all(Array.from({ length: Math.min(jobs, pending.length) }, async () => {
    for (let walk = pending.shift(); walk; walk = pending.shift()) await run(walk);
  }));
  const failed = results.filter((result) => !result.ok);
  const lines = [
    `| Walk | Result | Time |`,
    `|---|---|---|`,
    ...results.map((r) => `| ${r.walk} | ${r.ok ? "pass" : "**FAIL**"} | ${r.seconds}s |`),
    ``,
    `${results.length - failed.length}/${results.length} walks passed in ${Math.round((Date.now() - started) / 1000)}s, ${jobs} at a time (shard ${index}/${count}).`,
  ];
  console.log(`\n${lines.join("\n")}`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Desktop walks, shard ${index}/${count}\n\n${lines.join("\n")}\n`);
  process.exit(failed.length ? 1 : 0);
})();
