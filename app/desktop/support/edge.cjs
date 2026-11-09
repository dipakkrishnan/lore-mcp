// Walks the renderer through the edge audit's two personas against a seeded scratch home.
// Usage: support/edge.sh <scenario>   (seeds LORE_HOME, then runs this under Electron)
const { app, BrowserWindow, nativeTheme } = require("electron");
const { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { dirname, join } = require("node:path");
const scenario = process.argv.at(-1);
// APP-225: a walk is drawn light unless LORE_EDGE_APPEARANCE=dark; edge.sh keeps that choice as the app would.
const DARK = process.env.LORE_EDGE_APPEARANCE === "dark";
const S = process.env.LORE_EDGE_OUT ?? process.env.LORE_HOME;
const src = join(__dirname, "../src");
// The desktop key lives in this walk's scratch, never the owner's account, so walks run side by side
// without clobbering each other's (or the owner's) key. state.cjs reads the account's home once, at load.
const os = require("node:os");
const userInfo = os.userInfo;
os.userInfo = (...args) => ({ ...userInfo(...args), homedir: join(S, "account") });
const runtime = require(join(src, "runtime.cjs"));
os.userInfo = userInfo;
const { ATTENDED_KEYS } = require(join(src, "state.cjs"));
// The CLI the app spawns reads the same scratch key: a test-only entry point, picked the way the app picks its runtime.
const repo = join(__dirname, "../../..");
const cli = { bin: join(S, "cli", "lore"), binDir: undefined };
mkdirSync(dirname(cli.bin), { recursive: true });
writeFileSync(join(S, "cli", "attended_cli.py"), `import sys\nfrom pathlib import Path\nfrom lore import cli\ncli.attended_folder = lambda: Path(${JSON.stringify(dirname(ATTENDED_KEYS))})\nsys.exit(cli.main())\n`);
// APP-271: the project's own environment straight, once uv has built it (CI's `uv sync --locked` does), as `uv run`
// would put it first on PATH: the app makes hundreds of these calls a walk, and each `uv run` looks at the lock again.
writeFileSync(cli.bin, `#!/bin/sh\ncd ${JSON.stringify(repo)} || exit 1\nif [ -x .venv/bin/python ]; then PATH="$PWD/.venv/bin:$PATH" VIRTUAL_ENV="$PWD/.venv" exec .venv/bin/python ${JSON.stringify(join(S, "cli", "attended_cli.py"))} "$@"; fi\nexec uv run python ${JSON.stringify(join(S, "cli", "attended_cli.py"))} "$@"\n`, { mode: 0o755 });
/** APP-271: `uv run <args>` for the walk's own CLI calls, through the same environment straight when uv has built it.
 * @param {string[]} args @param {import("node:child_process").ExecFileSyncOptions} options */
const uvRun = (args, options) => {
  const venv = join(repo, ".venv", "bin");
  if (!existsSync(join(venv, "python"))) return execFileSync("uv", ["run", ...args], options);
  const env = options.env ?? process.env;
  return execFileSync(join(venv, args[0]), args.slice(1), { ...options, env: { ...env, PATH: `${venv}:${env.PATH}`, VIRTUAL_ENV: dirname(venv) } });
};
// APP-270: the seller walk launches into a setup that fails, as the retired provision walk did, then recovers from it.
let failSetup = scenario === "seller";
// main.cjs binds provision at require time, so the stub itself must flip.
runtime.provision = async () => { if (failSetup) throw new Error("uv exploded"); return cli; };
// APP-216: the agent apps on this Mac are whatever a walk says, and opening one only records it; the Mac's own
// Applications are never looked at, and no app is launched.
const { AgentApps } = require(join(src, "agents.cjs"));
/** @type {AgentApp[]} */
let installedApps = [];
/** @type {unknown[]} */
const launched = [];
AgentApps.prototype.installed = async () => installedApps;
AgentApps.prototype.open = async (id) => { if (!installedApps.includes(/** @type {AgentApp} */ (id))) throw new Error("Lore can't open that app"); launched.push(id); };

// APP-105: a relay that answers slowly, so the dialog can be poked while a
// report is genuinely in flight. Every report reaches this and nothing else —
// `lore()` spreads process.env into the CLI it spawns, so LORE_FEEDBACK_URL
// reaches both `desktop-state` (which is what un-hides the button) and
// `report-feedback`. main.cjs is required only once the port is known.
// XC-036: the request form opens in the browser; record it instead.
const opened = [];
/** MON-037: every Mac notification Lore posted, in order. */
const notes = [];
/** AUT-005: what the dock's badge was set to, and every reading Lore started. @type {number[]} */
const badges = [];
/** @type {Reading[]} */
const readings = [];
/** AUT-008: every check-in Lore looked over. @type {CheckInJob[]} */
const checkIns = [];
/** APP-212: the agents walk holds its first reading back until it lets it land. */
let releaseReading = () => {};
let readingHeld = Promise.resolve();
/** APP-233: how many of the agents walk's readings have handed back what they wrote. */
let readingsLanded = 0;
/** When each of the agents walk's readings started, for a check that fails to say how long the read took. @type {number[]} */
const readTimes = [];
/** APP-207: what the owner copied, and every turn the owner started. */
const copied = [];
const prompts = [];
/** APP-215: whether the first-run walk's owner has signed in to Cloudflare, and that sign-in as each store-online call found it. */
let signedInToCloudflare = false;
/** APP-223: whether the walk's sign-in waits on the browser until stopped, how long the app waits on it, and whether
 * the account signed in to already has a Lore store. */
let signInHangs = false;
/** @type {number | undefined} */
let signInWait;
/** XC-088: whether the hosted store can't be reached, so putting it online fails; each try records it. */
let storeUnreachable = false;
/** @type {boolean[]} */
const storeOnlineCalls = [];
/** The first-run steps the renderer reported, in order. @type {string[]} */
const steps = [];
/** Every call the renderer made to the main process, by channel. */
const ipc = [];
/** APP-271: each of those calls, by the same index: when it started and when it was answered (0 while it is out). */
const calls = /** @type {{ started: number, answered: number }[]} */ ([]);
/** How many calls are out, and when the last one started or was answered, so a walk can wait for the app to go quiet. */
let outstanding = 0;
let lastCallAt = 0;
/** APP-271: every check Lore's clock (Schedule) and its watch on the owner's agents (Watch) started, by number, and
 * which have finished, so a walk waits for the check a step set off instead of a fixed while. */
const lookedAt = { schedule: { started: 0, finished: /** @type {number[]} */ ([]) }, watch: { started: 0, finished: /** @type {number[]} */ ([]) } };
for (const [kind, { prototype }] of /** @type {const} */ ([["schedule", require(join(src, "routines.cjs")).Schedule], ["watch", require(join(src, "agents.cjs")).Watch]])) {
  const check = prototype.check;
  prototype.check = function (/** @type {unknown[]} */ ...args) {
    const id = lookedAt[kind].started++;
    return Promise.resolve(check.apply(this, args)).finally(() => { lookedAt[kind].finished.push(id); });
  };
}
/** APP-215: calls the firstrun walk holds until it lets them go, and calls it makes fail once, by channel.
 * @type {Map<string, Promise<unknown>>} */
const held = new Map();
/** @type {Set<string>} */
const failOnce = new Set();
/** Calls on `channel` answered as of now but handed back only once the returned function is called. @type {Map<string, Promise<unknown>>} */
const late = new Map();
/** @param {string} channel */
const holdAnswer = (channel) => {
  let release = () => {};
  late.set(channel, new Promise((done) => { release = () => { late.delete(channel); done(undefined); }; }));
  return release;
};
/** Hold every call on `channel` until the returned function is called. @param {string} channel */
const hold = (channel) => {
  let release = () => {};
  held.set(channel, new Promise((done) => { release = () => { held.delete(channel); done(undefined); }; }));
  return release;
};
{
  const { ipcMain } = require("electron");
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
    const call = { started: Date.now(), answered: 0 };
    ipc.push(channel);
    calls.push(call);
    outstanding++;
    lastCallAt = call.started;
    const answer = new Promise((done) => {
      if (channel === "usage:record" && args[0] === "firstrun.step") steps.push(args[1]);
      if (failOnce.delete(channel)) throw new Error("the walk made this fail");
      const waiting = held.get(channel);
      if (waiting) return done(waiting.then(() => listener(event, ...args)));
      const answered = late.get(channel);
      if (answered) return done(Promise.resolve(listener(event, ...args)).then((answer) => answered.then(() => answer)));
      done(listener(event, ...args));
    });
    return answer.finally(() => {
      outstanding--;
      call.answered = lastCallAt = Date.now();
    });
  });
}
if (scenario === "connectors") {
  // A newsletter to address, served from a fixture; and the file dialog answered with the export
  // the seed left, since a native dialog cannot be driven from here.
  const { readFileSync } = require("node:fs");
  const { dialog } = require("electron");
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [join(S, "chatgpt.json")] });
  // Each feed app's fixture at its own path: /medium, /blog; anything else is the newsletter.
  // /slow is a blog that takes its time, so a connect can be closed while it is still reading.
  const newsletter = require("node:http").createServer((request, response) => {
    const name = ["medium", "blog", "slow"].find((n) => request.url?.startsWith(`/${n}`)) ?? "substack";
    setTimeout(() => {
      response.writeHead(200, { "Content-Type": "application/rss+xml" });
      response.end(readFileSync(join(S, `${name === "slow" ? "blog" : name}.xml`)));
    }, name === "slow" ? 4000 : 0);
  });
  newsletter.listen(0, "127.0.0.1", () => {
    process.env.LORE_EDGE_NEWSLETTER = `http://127.0.0.1:${newsletter.address().port}/`;
    require(join(src, "main.cjs"));
  });
} else if (["routines", "checkin"].includes(scenario)) {
  // AUT-005: everything around a reading is real except the model. The stand-in writes what a
  // reading of the two stand-in Granola meetings would, then hands it back as the agent would.
  // AUT-006 reuses it: what Lore's own schedule brings in lands the same way. AUT-008's check-in
  // stand-in answers as a model would: something worth asking about.
  require(join(src, "sales.cjs")).notify = (words, onClick) => { notes.push({ words, handlers: { click: onClick } }); };
  const setBadgeCount = app.setBadgeCount.bind(app);
  app.setBadgeCount = (count) => { badges.push(count); return setBadgeCount(count); };
  void import(require("node:url").pathToFileURL(join(src, "agent.mjs")).href).then(({ LoreAgent }) => {
    /** The stand-in's work still under way, as the real agent's settled() would wait for it. @type {Promise<unknown>} */
    let quiet = Promise.resolve();
    /** `work` once `ms` have passed and `until` has settled. @param {number} ms @param {() => unknown} work @param {Promise<unknown>} [until] */
    const later = (ms, work, until = Promise.resolve()) => { quiet = Promise.all([quiet, Promise.all([new Promise((done) => setTimeout(done, ms)), until]).then(work)]); };
    LoreAgent.prototype.settled = () => quiet.then(() => undefined);
    LoreAgent.prototype.synthesize = function (/** @type {Reading} */ reading) {
      readings.push(reading);
      readTimes.push(Date.now());
      const folder = join(process.env.LORE_HOME ?? "", "memories");
      mkdirSync(join(folder, "work"), { recursive: true });
      // APP-270: the routines walk reads three times. Granola's reading writes the memories its checks name; any other
      // writes two of its own, so Granola's are never credited first to another reading's app.
      const granola = reading.label === "Granola";
      const [sellable, kept] = granola ? ["first-price-after-ten-buyers.md", "work/ops-management-before-hiring.md"] : ["hold-first-tier.md", "work/leads-before-the-wave.md"];
      writeFileSync(join(folder, sellable), granola ? "# Raise the first price only after ten buyers pay\n\nA receipt beats a survey: hold the first tier until ten buyers have paid, then raise it. From a pricing review, January 2026.\n" : "# Hold the first tier until the receipts are in\n\nKeep the opening price until real buyers have paid for it; a survey is not a receipt. From a pricing note, February 2026.\n");
      writeFileSync(join(folder, kept), granola ? "# Add the ops management layer before the next ten hires\n\nWork: the team's own hiring plan, from an internal ops sync.\n\nAdd the management layer before the next ten engineers join, not after.\n" : "# Name the team leads before the hiring wave\n\nWork: the team's own plan, from an internal sync.\n\nName the leads before the next group of engineers starts, not after.\n");
      // After the connect's own refresh, which reads tasks from disk where this stand-in keeps none.
      setTimeout(() => this.options.emit({ type: "task", task: { version: 1, kind: "synthesize", title: "Read what came in", state: "working", phase: reading.phase, updatedAt: new Date().toISOString() } }), 1500);
      // APP-271: it lands a second after it said it was working, or, when the walk holds it (to look at it working), once
      // the walk lets it go. The walk needs the order, not the six seconds this took before.
      const held = readingHeld;
      readingHeld = Promise.resolve();
      later(2500, () => {
        this.options.emit({ type: "task", task: { version: 1, kind: "synthesize", title: "Read what came in", state: "done", phase: "Finished", updatedAt: new Date().toISOString() } });
        return this.options.memoriesReady?.(reading, {
          read: reading.added,
          memories: [
            { file: sellable, worth_selling: true, why: "a measured pricing rule" },
            { file: kept, worth_selling: true, why: "names the team's plan" }
          ]
        });
      }, held);
    };
    LoreAgent.prototype.checkIn = function (/** @type {CheckInJob} */ job) {
      checkIns.push(job);
      const [item] = job.items;
      const question = checkIns.length === 1 ? "You held the price on the Acme call. What made you hold firm?" : "What made you walk away from the Globex renewal?";
      // APP-269: the quiet day's verdict (reach_out false) is test/unit/ipc.test.cjs and test/component/agent.test.cjs now.
      // APP-271: two seconds, not seven: nothing the walk checks happens while a check-in is still looking.
      later(2000, () => this.options.checkedIn?.(job, { reach_out: true, why: "a decision with no reason given", questions: [{ question, memory: item.id }] }));
    };
    require(join(src, "main.cjs"));
  });
} else if (scenario === "store") {
  // APP-290, moved here from the retired today walk (APP-269), then from the retired inventory walk (APP-270): a fake
  // microphone the app may use, so Record a memory opens its thread listening and the listening composer is scanned.
  // What talking it through does is test/unit/renderer-talk.test.cjs.
  app.commandLine.appendSwitch("use-fake-device-for-media-stream");
  app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
  const { ipcMain } = require("electron");
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, channel === "dictation:permission" ? async () => true : listener);
  require(join(src, "main.cjs"));
} else if (scenario === "agents" || scenario === "firstrun") {
  // APP-207: everything around an agent's save is real (the CLI, the stand-in node's D1 and /agent) except the
  // model and the deploy. The deploy stand-in leaves what a real one does: the node's wrangler, and the store's address.
  const repo = process.env.LORE_EDGE_REPO ?? "";
  const standInDeploy = () => {
    const wrangler = join(process.env.LORE_STORE ?? "", "node_modules/.bin/wrangler");
    mkdirSync(dirname(wrangler), { recursive: true });
    writeFileSync(wrangler, `#!/bin/sh\ncd "${repo}" && exec uv run python -m tests.fixtures.inbox wrangler "$@"\n`, { mode: 0o755 });
    writeFileSync(join(process.env.LORE_STORE ?? "", ".installed"), "");
    const url = `${process.env.LORE_EDGE_AGENT_URL}/mcp`;
    // XC-069: what `lore node deploy --inbox-only` leaves: an address, nothing for sale, no price and no payout. The
    // stand-in node answers only /agent, so its probe is kept for the whole walk instead of expiring a minute in.
    uvRun(["python", "-c", `import time\nfrom lore.store import Store\nwith Store() as s:\n s.set_setting('node_url', '${url}')\n s.set_setting('node_selling', False)\n s.set_setting('node_live', {'url': '${url}', 'checked_at': time.time() + 3600, 'live': {'state': 'online', 'network': None, 'price_usd': None, 'payout': None}, 'ids': []})`], { cwd: repo, env: process.env });
  };
  // XC-088: the place online for the owner's agents, which Lore hosts, stood in for by the stand-in node, so nothing
  // reaches yourlore.dev. It fails, in the CLI's own words, while the walk says it can't be reached.
  const state = require(join(src, "state.cjs"));
  state.storeOnline = async () => {
    storeOnlineCalls.push(storeUnreachable);
    if (storeUnreachable) throw new Error("Lore couldn't put your store online: yourlore.dev didn't answer (offline)");
    standInDeploy();
  };
  // APP-223: the real sign-in, its wait and its stop, with the CLI's `node login` stood in for by a process that prints
  // the page to open, then signs in at once or waits on the browser until it is stopped. Pages open nowhere.
  const realSignIn = state.cloudflareSignIn;
  state.cloudflareSignIn = (home, onUrl, options) => realSignIn(home, onUrl, {
    ...options,
    ...(signInWait ? { wait: signInWait } : {}),
    login: (onLine, signal) => state.stream("/bin/sh", ["-c", `echo "Open https://dash.cloudflare.com/oauth2/auth?walk=1 to sign in"; ${signInHangs ? "exec sleep 600" : "exit 0"}`], {}, onLine, S, signal).then(() => { signedInToCloudflare = true; })
  });
  require("electron").shell.openExternal = async (url) => { opened.push(url); };
  require(join(src, "sales.cjs")).notify = (words, onClick) => { notes.push({ words, handlers: { click: onClick } }); };
  require("electron").clipboard.writeText = (text) => { copied.push(text); };
  const setBadgeCount = app.setBadgeCount.bind(app);
  app.setBadgeCount = (count) => { badges.push(count); return setBadgeCount(count); };
  void import(require("node:url").pathToFileURL(join(src, "agent.mjs")).href).then(({ LoreAgent }) => {
    const at = () => new Date().toISOString();
    LoreAgent.prototype.prompt = async function (/** @type {string} */ text, /** @type {AgentTask} */ task) {
      prompts.push({ text, task });
      if (task !== "deploy") return;
      this.options.emit({ type: "task", task: { version: 1, kind: "deploy", title: "Open your store", state: "working", phase: "Setting up your store", updatedAt: at() } });
      standInDeploy();
      this.options.emit({ type: "task", task: { version: 1, kind: "deploy", title: "Open your store", state: "done", phase: "Finished", updatedAt: at() } });
    };
    LoreAgent.prototype.synthesize = function (/** @type {Reading} */ reading) {
      readings.push(reading);
      readTimes.push(Date.now());
      // APP-271: half a second, not one and a half: what Lore judged lands after the save's notification either way.
      const land = (/** @type {ReadingReport} */ report) => setTimeout(() => void readingHeld.then(() => this.options.memoriesReady?.(reading, report)).then(() => { readingsLanded++; }), 500);
      // An agent's saves are only judged: nothing written, and the first of them judged worth selling.
      if (reading.judge) {
        const first = Math.min(...reading.judge.map((save) => save.id));
        land({ read: reading.judge.length, memories: reading.judge.map(({ id }) => id === first ? { id, worth_selling: true, why: "a pricing rule from real placements" } : { id, worth_selling: false, why: "" }) });
        return;
      }
      const folder = join(process.env.LORE_HOME ?? "", "memories");
      mkdirSync(folder, { recursive: true });
      // One topic per reading, so each of the walk's saves brings something new.
      const [file, text] = [
        ["pricing-sync-by-reach.md", "# Price a sync placement by its reach\n\nCharge by the audience the placement reaches, not by the hours it took. From what Grok saved, October 2026.\n"],
        ["late-sync-note.md", "# Write down a sync change the day it happens\n\nA change noted late is a change argued about later. From what Grok saved, October 2026.\n"],
        ["rush-fee-up-front.md", "# Quote a rush fee up front\n\nName the rush fee before the work starts, never after it ships. From what Grok saved, October 2026.\n"],
        ["rerun-at-half.md", "# Bill a rerun at half the first fee\n\nA rerun costs half the first fee, because the work is already done. From what Grok saved, October 2026.\n"],
        ["sign-off-in-writing.md", "# Get the final cut signed off in writing\n\nA written sign-off ends the revisions; a nod on a call starts more. From what Grok saved, October 2026.\n"]
      ][readings.length - 1];
      writeFileSync(join(folder, file), text);
      land({ read: reading.added, memories: [{ file, worth_selling: true, why: "a pricing rule from real placements" }] });
    };
    require(join(src, "main.cjs"));
  });
} else {
  require(join(src, "main.cjs"));
}

/** APP-271: where a walk's time goes, said in two TIME lines as it ends (edge.sh prints them): the layout scans, the
 * pictures, the fixed sleeps, and the longest stretches between one check and the next. */
const spent = { from: Date.now(), slept: 0, scanning: 0, picturing: 0, scans: 0, marks: /** @type {[string, number][]} */ ([]), gaveUp: /** @type {string[]} */ ([]) };
/** @param {number} ms */
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
/** APP-271: a fixed wait, kept only where there is no state to watch, or where the time itself is what a check needs;
 * every one says which. Anything else waits on its condition with `until` or `waitFor`. @param {number} ms */
const sleep = (ms) => { spent.slept += ms; return pause(ms); };
/** APP-271: polls `test` every 50 ms until it holds, giving up only once it has been asked `tries` times and `ms` have
 * passed. Says whether it held. @param {() => unknown} test @param {number} [ms] @param {number} [tries] */
const until = async (test, ms = 10_000, tries = 1) => {
  const end = Date.now() + ms;
  for (let asked = 1; ; asked++) {
    if (await test()) return true;
    if (asked >= tries && Date.now() >= end) {
      // Said in the TIME lines: where in this file a wait ran out, which is time a walk spent for nothing.
      spent.gaveUp.push([...(new Error().stack ?? "").split("\n").slice(2).join("\n").matchAll(/edge\.cjs:(\d+)/g)].slice(0, 3).map((line) => line[1]).join("<") || "?");
      return false;
    }
    await pause(50);
  }
};
/** APP-271: the app has gone quiet: no call from the page is out, and none started or was answered in the last quarter
 * second (the gap between main saying something changed and the page asking again is a few milliseconds). What a step
 * sets off has then been drawn, so a check that something did not happen can be made. */
const idle = async () => {
  if (await until(() => outstanding === 0 && Date.now() - lastCallAt >= 250, 30_000)) return true;
  spent.gaveUp.push(`idle with ${calls.flatMap((call, at) => (call.answered ? [] : [ipc[at]])).join(", ")} out`);
  return false;
};
/** APP-271: whether a call on `channel` that started at or after call number `from` has been answered. @param {string} channel @param {number} from */
const answeredSince = (channel, from) => ipc.slice(from).some((each, at) => each === channel && calls[from + at].answered > 0);
/** APP-271: waits until a check of Lore's clock or its agents' watch started at or after number `from` has finished.
 * @param {"schedule" | "watch"} kind @param {number} from */
const lookedSince = (kind, from) => until(() => lookedAt[kind].finished.some((id) => id >= from), 30_000);
const results = [];
function check(name, ok, detail = "") {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  spent.marks.push([name, Date.now()]);
}
/** APP-218: what reads wrong on screen, found in the page itself: the page or a box wider than its room, a one-line
 * label on two lines, text or a control cut off by its box, two neighbours drawn over each other, text or the focused
 * control hidden under something painted over it, or a dialog running off the window. Text meant to run on (a message,
 * a memory, a hint) says so with data-wraps on its own box. Returns what it found, one line each. */
const LAYOUT = String.raw`(() => {
  const found = new Set();
  const describe = (node) => {
    const classes = typeof node.className === "string" && node.className.trim() ? "." + node.className.trim().split(/\s+/).join(".") : "";
    return node.tagName.toLowerCase() + (node.id ? "#" + node.id : "") + classes + ' "' + (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48) + '"';
  };
  const css = (node) => getComputedStyle(node);
  const shown = (node) => {
    const box = node.getBoundingClientRect();
    if (box.width < 1 || box.height < 1) return false;
    const style = css(node);
    return style.visibility !== "hidden" && Number(style.opacity) > 0.05;
  };
  const scrolls = (style) => /auto|scroll/.test(style.overflowX + style.overflowY);
  const inner = (node) => {
    const box = node.getBoundingClientRect();
    return { left: box.left + node.clientLeft, top: box.top + node.clientTop, right: box.left + node.clientLeft + node.clientWidth, bottom: box.top + node.clientTop + node.clientHeight };
  };
  const meet = (a, b) => {
    const box = { left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) };
    return box.right - box.left > 0.5 && box.bottom - box.top > 0.5 ? box : null;
  };
  const layer = (node) => node.closest("dialog[open], :popover-open, .peek");
  /** Where a box can be seen: inside the window and every box that scrolls around it; null once scrolled out of sight. */
  const inView = (node, box = node.getBoundingClientRect()) => {
    let seen = meet(box, { left: 0, top: 0, right: innerWidth, bottom: innerHeight });
    for (let around = node.parentElement; seen && around && around !== document.body; around = around.parentElement) if (scrolls(css(around))) seen = meet(seen, inner(around));
    return seen;
  };
  /** The part of a box its own clip and every clip around it let show: an ellipsized line ends where its "…" does. */
  const showing = (node, box) => {
    for (let around = node; box && around && around !== document.documentElement; around = around.parentElement) {
      const style = css(around);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") box = meet(box, inner(around));
    }
    return box;
  };
  const texts = (node) => {
    const runs = [];
    const walk = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let text = walk.nextNode(); text; text = walk.nextNode()) if (text.textContent.trim() && !text.parentElement.closest(".sr-only")) runs.push(text);
    return runs;
  };
  const rects = (text) => {
    const range = document.createRange();
    range.selectNodeContents(text);
    return [...range.getClientRects()].filter((box) => box.width > 0.5 && box.height > 0.5);
  };
  if (document.documentElement.scrollWidth > innerWidth + 1) found.add("the page scrolls sideways");
  const modal = document.querySelector("dialog:modal");
  const roots = (modal ? [modal, ...document.querySelectorAll(":popover-open, .peek")] : [...document.querySelectorAll("#welcome, #main, aside, dialog[open], :popover-open, .peek")]).filter(shown);
  const nodes = [...new Set(roots.flatMap((root) => [root, ...root.querySelectorAll("*")]))].filter((node) => node instanceof HTMLElement && shown(node) && !node.closest(".sr-only, details:not([open]) > :not(summary)"));
  // How far a box's own text and children run past its right inner edge; a child pulled out with a negative margin
  // (a hover background wider than its text) or placed on its own is meant to.
  const bleeds = (node) => /-/.test(css(node).marginLeft + css(node).marginRight) || ["absolute", "fixed"].includes(css(node).position);
  const past = (node) => inner(node).right;
  const spill = (node, blocks = false) => {
    let right = -Infinity;
    for (const kid of node.childNodes) {
      if (kid.nodeType === Node.TEXT_NODE && kid.textContent.trim() && !blocks) for (const box of rects(kid)) right = Math.max(right, box.right);
      else if (kid instanceof HTMLElement && shown(kid) && !bleeds(kid) && (!blocks || !css(kid).display.startsWith("inline"))) right = Math.max(right, kid.getBoundingClientRect().right);
    }
    return right - past(node);
  };
  // (a) wider than its room, and (c) cut off at its own edge: only the innermost box says it, not every box around it.
  // An ellipsis covers only the box's own line of text, never a block inside it that runs past.
  const wide = new Map();
  for (const node of nodes) {
    if (node.matches("input, textarea, select, img")) continue;
    const style = css(node);
    if (style.display === "inline") continue;
    if (node.scrollWidth - node.clientWidth > 1 && !scrolls(style)) {
      if (style.overflowX === "visible") { if (spill(node) > 1) wide.set(node, "wider than its box"); }
      else if (style.textOverflow !== "ellipsis") wide.set(node, "cut off at the side, with no ellipsis");
      else if (spill(node, true) > 1) wide.set(node, "cut off at the side, where its ellipsis can't reach");
    }
    const masked = style.webkitMaskImage !== "none" || style.webkitLineClamp !== "none";
    if (node.scrollHeight - node.clientHeight > 1 && (style.overflowY === "hidden" || style.overflowY === "clip") && !masked) wide.set(node, "cut off at the bottom");
  }
  for (const [node, what] of wide) if (![...wide.keys()].some((other) => other !== node && node.contains(other))) found.add(what + ": " + describe(node));
  // (c) cut off by a box around it that doesn't scroll: a control or a line of text, even when that box is too small to
  // be seen at all. A box that scrolls may hide what is scrolled out; a fade may end a preview; and a box with an ellipsis
  // may end its own line of text at the side, an inline run of text inside it included, but never a control, and never
  // from above or below.
  const CONTROL = "button, input, select, textarea, a[href], [role=button]";
  const clipper = (node) => {
    let box = node.getBoundingClientRect();
    for (let around = node.parentElement; around && around !== document.documentElement; around = around.parentElement) {
      const style = css(around);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") {
        if (scrolls(style)) { box = meet(box, inner(around)); if (!box) return null; }
        else if (style.webkitMaskImage === "none" && style.webkitLineClamp === "none") {
          const room = inner(around);
          const ellipsized = style.textOverflow === "ellipsis" && css(node).display === "inline" && !node.matches(CONTROL);
          if ((!ellipsized && (box.left < room.left - 1 || box.right > room.right + 1)) || box.top < room.top - 1 || box.bottom > room.bottom + 1) return around;
        }
      }
      if (around.matches("dialog, [popover], .peek")) break;
    }
    return null;
  };
  for (const node of nodes) {
    const speaks = node.matches(CONTROL) || [...node.childNodes].some((kid) => kid.nodeType === Node.TEXT_NODE && kid.textContent.trim());
    const around = speaks && clipper(node);
    if (around) found.add("cut off by the box around it: " + describe(node) + " in " + describe(around));
  }
  // (b) a label meant for one line, on two: its text, taken whole, on more than one line. A memory's title in its own
  // sheet, and a batch's title, are allowed to run on.
  const ONE_LINE = ".btn, button.choice, .chip, .status-pill, .pill, .shelf, .shelf-count, nav button, h1, h2, h3, legend, .eyebrow, .t b, .update, .ws, .form-label, .form-value, .new-mark, .routine-act, .agent-link-word, .new-menu button, .account-menu button, .palette-keys span, .back, kbd, .agent-wait, .quiet-hint";
  for (const node of nodes) {
    if (!node.matches(ONE_LINE) || node.matches(".sheet-head .t b, .batch-head .t b") || node.closest("[data-wraps], .md")) continue;
    const style = css(node);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
    const rows = [];
    for (const box of texts(node).flatMap(rects)) {
      const middle = (box.top + box.bottom) / 2;
      if (!rows.some((row) => Math.abs(row - middle) < line / 2)) rows.push(middle);
    }
    if (rows.length > 1) found.add("wraps onto a second line: " + describe(node));
  }
  // (c) neighbours on top of each other: boxes laid out side by side or one under another, never stacked on purpose
  // (an overlap made with a negative margin, like a stack of marks, is meant).
  const placed = (node) => {
    const style = css(node);
    return shown(node) && style.position !== "sticky" && style.display !== "contents" && !bleeds(node) && !/-/.test(style.marginTop) && !node.matches(".sr-only");
  };
  for (const node of nodes) {
    const boxes = /flex|grid/.test(css(node).display);
    const kids = [...node.children].filter((kid) => kid instanceof HTMLElement && placed(kid) && (boxes || !css(kid).display.startsWith("inline")));
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const [a, b] = [kids[i].getBoundingClientRect(), kids[j].getBoundingClientRect()];
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) found.add("drawn over its neighbour: " + describe(kids[i]) + " and " + describe(kids[j]));
      }
    }
  }
  // (c) hidden under something painted over it. A sticky bar may cover what has scrolled under it while it is stuck,
  // never what sits beside it at rest, and never the control in focus; an overlay (a menu, a preview, a dialog) may
  // cover the page under it. Only what is painted covers: a box with a background (or an image or a field) over all of
  // it, a see-through box (the window's drag strip) only where its own text is.
  const paintsAt = (node, x, y) => {
    const style = css(node);
    if (style.visibility === "hidden" || Number(style.opacity) <= 0.05) return false;
    if (!/rgba\(.*, 0\)$|transparent/.test(style.backgroundColor) || style.backgroundImage !== "none" || node.matches("img, svg, input, textarea, select")) return true;
    return [...node.childNodes].some((kid) => kid.nodeType === Node.TEXT_NODE && kid.textContent.trim() && rects(kid).some((line) => x >= line.left && x <= line.right && y >= line.top && y <= line.bottom));
  };
  /** A sticky bar is stuck only when it is pinned: its edge sits at its inset from the box it scrolls in (the padding
   * edge or the content edge), and it has left the place it would rest at without sticking. */
  // APP-271: asked once per bar a scan: each answer moves the bar and lays the page out again, and nothing moves it
  // between one text node and the next.
  const stuckBars = new Map();
  const stuck = (bar) => {
    if (!stuckBars.has(bar)) stuckBars.set(bar, isStuck(bar));
    return stuckBars.get(bar);
  };
  const isStuck = (bar) => {
    let scroller = bar.parentElement;
    while (scroller && !scrolls(css(scroller))) scroller = scroller.parentElement;
    if (!scroller) return false;
    const style = css(bar);
    const box = bar.getBoundingClientRect();
    const room = inner(scroller);
    const pad = css(scroller);
    const keep = bar.style.position;
    bar.style.position = "static";
    const rest = bar.getBoundingClientRect();
    bar.style.position = keep;
    const at = (edge, inset) => inset.some((place) => Math.abs(edge - place) <= 1);
    if (style.top !== "auto") return rest.top < box.top - 1 && at(box.top, [room.top + parseFloat(style.top), room.top + parseFloat(pad.paddingTop) + parseFloat(style.top)]);
    if (style.bottom !== "auto") return rest.bottom > box.bottom + 1 && at(box.bottom, [room.bottom - parseFloat(style.bottom), room.bottom - parseFloat(pad.paddingBottom) - parseFloat(style.bottom)]);
    return false;
  };
  const focused = document.activeElement instanceof HTMLElement && !document.activeElement.matches("body, main, #main") ? document.activeElement : null;
  /** Sets one property inline and important, which beats any rule, and hands back what puts the node's inline style
   * back exactly as it was. */
  const pin = (node, property, value) => {
    const was = node.getAttribute("style");
    node.style.setProperty(property, value, "important");
    return () => {
      // Written back through the attribute, which settles the style object first, so a node that had none gets none.
      node.setAttribute("style", was ?? "");
      if (was === null) node.removeAttribute("style");
    };
  };
  // What is painted over a point of a node, top first, down to the node itself: every box there, even one that lets
  // clicks through (pointer-events are switched on, inline and important so no rule can keep one out, for the look,
  // then put back as they were).
  const cover = (node, x, y) => {
    for (const hit of document.elementsFromPoint(x, y)) {
      if (hit === node || node.contains(hit)) return null;
      if (hit.contains(node) || !paintsAt(hit, x, y)) continue;
      if (hit.closest(":popover-open, .peek, dialog[open]") && layer(node) !== layer(hit)) continue;
      let bar = null;
      for (let up = hit; up && !up.contains(node) && !bar; up = up.parentElement) if (["sticky", "fixed"].includes(css(up).position)) bar = up;
      if (bar && css(bar).position === "sticky" && stuck(bar) && !(focused && (focused === node || focused.contains(node)))) continue;
      return hit;
    }
    return null;
  };
  /** Five points along the middle of a box that shows, so a cover over any part of a line is seen, not only its middle. */
  const across = (node, part) => {
    for (const share of [0.08, 0.3, 0.5, 0.7, 0.92]) {
      const over = cover(node, part.left + (part.right - part.left) * share, (part.top + part.bottom) / 2);
      if (over) return over;
    }
    return null;
  };
  const unpinned = [...document.querySelectorAll("*")].filter((node) => css(node).pointerEvents === "none").map((node) => pin(node, "pointer-events", "auto"));
  try {
    for (const node of nodes) {
      for (const text of [...node.childNodes].filter((kid) => kid.nodeType === Node.TEXT_NODE && kid.textContent.trim())) {
        for (const box of rects(text)) {
          const seen = inView(node, box);
          if (!seen || seen.bottom - seen.top < box.height - 1) continue;
          const part = showing(node, seen);
          const over = part && across(node, part);
          if (over) { found.add("hidden under " + describe(over) + ": " + describe(node)); break; }
        }
      }
    }
    if (focused && shown(focused)) {
      const box = focused.getBoundingClientRect();
      const seen = inView(focused);
      const over = seen && across(focused, seen);
      if (over) found.add("the control in focus is hidden under " + describe(over) + ": " + describe(focused));
      else if (!seen && box.width) found.add("the control in focus is out of sight: " + describe(focused));
    }
  } finally {
    for (const unpin of unpinned) unpin();
  }
  // A dialog, menu or preview runs off the window.
  for (const box of document.querySelectorAll("dialog[open], :popover-open, .peek")) {
    const edge = box.getBoundingClientRect();
    if (shown(box) && (edge.left < -1 || edge.top < -1 || edge.right > innerWidth + 1 || edge.bottom > innerHeight + 1)) found.add("runs off the window: " + describe(box));
  }
  return [...found];
})()`;
/** Animations that end, ended, the page's scrolling at rest, and frames painted, so a picture and its measurements show
 * where things land, not where they are on the way or a frame behind. Each pass finishes what is animating, finds the
 * boxes that scroll afresh, and waits for three frames in which no scroll moves and no animation starts or stops; it
 * passes again until a whole pass changes nothing. A page that never paints or never comes to rest fails the walk. */
const SETTLE = String.raw`(async () => {
  const frame = () => new Promise((painted, stalled) => {
    const late = setTimeout(() => stalled(new Error("the page painted no frame in 8s")), 8000);
    requestAnimationFrame(() => { clearTimeout(late); painted(); });
  });
  const ending = () => document.getAnimations().filter((motion) => motion.playState === "running" && motion.effect?.getComputedTiming().endTime !== Infinity);
  const state = () => [...document.querySelectorAll("*")].filter((node) => node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth).map((node) => node.scrollTop + ":" + node.scrollLeft).join(" ") + " | " + ending().length;
  for (let pass = 0; ; pass++) {
    if (pass > 12) throw new Error("the page never came to rest in 12 passes");
    const before = state();
    const finished = ending();
    for (const motion of finished) motion.finish();
    let last = state();
    for (let still = 0, frames = 0; still < 3; frames++) {
      if (frames > 180) throw new Error("the page kept moving for 180 frames");
      await frame();
      const now = state();
      still = now === last ? still + 1 : 0;
      last = now;
    }
    if (!finished.length && last === before) return true;
  }
})()`;
/** APP-271: whether shot() keeps a picture beside its scan: on a Mac someone walks by hand, yes; on CI, whose files go
 * with the runner and are never uploaded, no. LORE_EDGE_IMAGES=1 keeps them anywhere, =0 nowhere. */
const IMAGES = process.env.LORE_EDGE_IMAGES ? process.env.LORE_EDGE_IMAGES === "1" : !process.env.CI;
/** APP-218: the walks that show the main tabs are checked again at a narrower window. */
const NARROW = new Set(["store", "connectors", "routines", "settings", "firstrun", "agents"]);
const NARROW_WIDTH = 900;
/** The page's background token, light or dark. */
const BG = `getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()`;
const LIGHT_BG = "#fcfcfd";
const DARK_BG = "#0f1011";
check("the desktop key is this walk's own", ATTENDED_KEYS.startsWith(join(S, "account") + "/"), ATTENDED_KEYS);

/** The walk runs once, in the first window; one opened later (a notification after the window closed) is driven by it. */
let walking = false;
app.on("browser-window-created", (/** @type {unknown} */ _event, /** @type {import("electron").BrowserWindow} */ window) => {
  if (window.getParentWindow()) return; // a page preview, not the app
  if (walking) return;
  walking = true;
  // The walk drives the page itself. A real click from whoever is working on this Mac passes through to the window
  // beneath, so it can never switch a view or close a sheet in the middle of a walk.
  window.setIgnoreMouseEvents(true);
  const js = (code) => window.webContents.executeJavaScript(code);
  const todayShown = `Boolean(snapshot) && view === "inbox" && !detailTask && document.querySelector("#content").childElementCount > 0`;
  /** APP-218: every picture is checked for broken text first, at the window's size and, in the walks that show the
   * main tabs, at a narrower one too. APP-271: the scan always runs; the picture is kept only where IMAGES says.
   * @param {string} name */
  const shot = async (name) => {
    const layout = async (where) => {
      const from = Date.now();
      await js(SETTLE);
      const found = await js(LAYOUT);
      spent.scanning += Date.now() - from;
      spent.scans++;
      check(`the text sits right in ${where}`, !found.length, found.join(" | "));
    };
    const picture = async (file) => {
      if (!IMAGES) return;
      const from = Date.now();
      writeFileSync(join(S, file), (await window.webContents.capturePage()).toPNG());
      spent.picturing += Date.now() - from;
    };
    await layout(name);
    await picture(`${name}.png`);
    if (!NARROW.has(scenario)) return;
    const { debugger: devtools } = window.webContents;
    if (!devtools.isAttached()) devtools.attach();
    const wide = await js(`innerWidth`);
    await devtools.sendCommand("Emulation.setDeviceMetricsOverride", { width: NARROW_WIDTH, height: window.getContentSize()[1], deviceScaleFactor: 0, mobile: false });
    // APP-271: on the narrow width once the page itself is (SETTLE then waits for it to be drawn there).
    await until(() => js(`innerWidth === ${NARROW_WIDTH}`));
    await layout(`${name}, ${NARROW_WIDTH}px wide`);
    await picture(`${name}-narrow.png`);
    await devtools.sendCommand("Emulation.clearDeviceMetricsOverride");
    await until(() => js(`innerWidth === ${wide}`));
  };
  /** APP-222: the walk says whether motion is reduced, never the Mac running it: CI's runner has Reduce motion on, which
   * would leave every shimmer and ink-in standing still. @param {boolean} reduce */
  const motion = (reduce) => window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] });
  /** Whether a node has a running animation of that name. @param {string} node @param {string} name */
  const animating = (node, name) => `(${node})?.getAnimations().some((a) => a.animationName === ${JSON.stringify(name)} && a.playState === "running") === true`;
  /** Whether `code` holds in the page within `tries` quarter seconds (and at least `tries` asks). APP-271: asked every
   * 50 ms, so a wait ends as soon as the page gets there. @param {string} code */
  const waitFor = (code, tries = 40) => until(() => js(code), tries * 250, tries);
  // A key event says nothing when the page has had it, so it gets a moment to land before the next step.
  const key = async (type, keyCode) => { window.webContents.sendInputEvent({ type, keyCode }); await sleep(30); };

  window.webContents.once("did-finish-load", async () => {
    try {
      // Focus events need a focused page, which a window launched in the background never is.
      window.webContents.debugger.attach();
      await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await motion(false);
      // APP-218: a window behind others still paints frames, so every screenshot waits on real ones.
      window.webContents.setBackgroundThrottling(false);
      // APP-271: the page has drawn its theme, in place of a second and a half before anything.
      await waitFor(`${BG} === ${JSON.stringify(DARK ? DARK_BG : LIGHT_BG)}`);
      check(`the window is drawn ${DARK ? "dark" : "light"}, as kept`, nativeTheme.shouldUseDarkColors === DARK && (await js(BG)) === (DARK ? DARK_BG : LIGHT_BG), await js(BG));
      if (scenario === "store") {
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        // APP-271: the Inbox is drawn. This waited ten seconds every run for "Approve what to sell", which the Inbox no
        // longer says (APP-283 lists each draft as a row), and went on when the wait ran out.
        await waitFor(`${todayShown} && Boolean(document.querySelector("#content .irow.draft"))`);
        // Fix 4: with a store open, Settings offers a way back into the deploy conversation.
        await js(`window.__lore.show("settings")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Switch to real payments") && [...document.querySelectorAll("#content button")].some((b) => /^(Set a price|Change)$/.test(b.textContent))`);
        const settings = await js(`document.querySelector("#content").textContent`);
        check("Settings offers to set the price once a store exists", await js(`[...document.querySelectorAll("#content button")].some((b) => /^(Set a price|Change)$/.test(b.textContent))`));
        // Ledger: the payout address links to Basescan on the live network, in Settings.
        check("Settings shows the payout address", settings.includes("0xaaaa…aaaa"));
        check("…linked to the address on Sepolia Basescan", await js(`[...document.querySelectorAll("#content a.link-btn")].some((a) => a.textContent === "View ↗" && a.href === "https://sepolia.basescan.org/address/0x${"a".repeat(40)}")`));
        check("Settings offers the switch to real payments while on the test network", settings.includes("Switch to real payments"));
        // shot() settles the scroll before it scans.
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await shot("settings-store");
        // APP-019: one editor on For Sale; a saved price the node does not charge yet is standing state on For Sale and Today.
        await js(`[...document.querySelectorAll("#content button")].find((b) => /^(Set a price|Change)$/.test(b.textContent)).click()`);
        const priceInput = `document.querySelector("dialog.form-sheet[open] input[aria-label='Price per publication in US dollars']")`;
        await waitFor(priceInput);
        check("Settings' Change price opens the price sheet in place, on its field", await js(`document.querySelector("#title").textContent === "Settings" && document.querySelector("dialog.form-sheet[open]")?.getAttribute("aria-label") === "Price" && document.activeElement === ${priceInput}`));
        await js(`{ const field = ${priceInput}; field.value = "0"; field.form.requestSubmit(); }`);
        check("zero is refused in the sheet, which stays open", await waitFor(`document.querySelector("dialog.form-sheet[open] .problem")?.textContent.includes("above zero") && Boolean(${priceInput})`));
        await js(`{ const field = ${priceInput}; field.value = "0.75"; field.form.requestSubmit(); }`);
        check("a saved price closes the sheet", await waitFor(`!document.querySelector("dialog.form-sheet[open]:not(.changes-sheet)")`));
        // APP-226: what an update puts out waits on the owner's Confirm, piece by piece and term by term.
        const changes = `document.querySelector("dialog.changes-sheet[open]")`;
        const answerChanges = (/** @type {string} */ label) => js(`[...${changes}.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        check("the store charges a new price only once the owner confirms it", await waitFor(`${changes}?.textContent.includes("$0.02 a piece → $0.75 a piece")`), await js(`${changes}?.textContent ?? ""`));
        await answerChanges("Cancel");
        await waitFor(`!document.querySelector("dialog.changes-sheet[open]")`);
        const address = `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector(".t b")?.textContent === "Address")`;
        await waitFor(`${address}?.textContent.includes("Your store still charges $0.02.")`);
        check("a saved price the node does not charge yet says so in Settings, beside the address", await js(`${address}.textContent.includes("Your store still charges $0.02.")`), await js(`${address}.textContent`));
        check("…with exactly one Update store control there", await js(`[...${address}.querySelectorAll("button, a")].filter((b) => b.textContent === "Update store").length === 1`));
        await shot("store-stale-price");
        await js(`window.__lore.show("store")`);
        const salesGroup = `[...document.querySelectorAll("#content .igroup")].find((g) => g.textContent.startsWith("Sales"))`;
        await waitFor(`${salesGroup} && !document.querySelector("#content").textContent.includes("Checking your store…")`);
        const salesBox = await js(`[...document.querySelectorAll("#content .invrow")].filter((r) => r.dataset.key.startsWith("sales:")).map((r) => r.textContent).join("|")`);
        check("a store not opened on this Mac says so about sales, in plain words", salesBox.includes("Sales show here once your store is open on this Mac.") && !/deployed|node|machine/.test(salesBox), salesBox);
        await js(`window.__lore.show("inbox")`);
        const nextStep = `(document.querySelector("#content .irow.step")?.textContent ?? "")`;
        check("the Inbox's next step is the update, in plain words", await waitFor(`${nextStep}.includes("1 change isn't live yet · Your store still charges $0.02, not $0.75Update store")`), await js(nextStep));
        // Fix 5: approved work the node does not hold yet gets a standing Push, on For Sale and as the Inbox's next step.
        await js(`window.__lore.show("drafts")`);
        // APP-134, from the retired sell walk (APP-270): a draft previews as the page buyers will see, in its own window. What
        // the page holds is test/unit/app.test.cjs; that the window runs no script only Electron can say.
        await waitFor(`document.querySelector("#content .read-title")`);
        await js(`document.querySelector("#content .read-title").click()`);
        /** @type {import("electron").BrowserWindow | undefined} */
        let preview;
        // APP-271: the preview's own page has loaded, in place of a fixed wait after it opened.
        await until(() => (preview = window.getChildWindows()[0]) && preview.webContents.getURL() !== "" && !preview.webContents.isLoading());
        const page = decodeURIComponent(preview?.webContents.getURL() ?? "");
        check("Preview page opens the draft's page in its own window", page.includes("When to add managers in a fast-growing team."));
        check("the preview carries no paid text", !page.includes("Add the management layer"));
        check("the preview window runs no script", preview?.webContents.getLastWebPreferences().javascript === false);
        preview?.close();
        await until(() => !window.getChildWindows().length);
        const pushJobs = `window.lore.snapshot().then((s) => (s.jobs?.items ?? []).filter((j) => j.kind === "push").length)`;
        const pushedBefore = await js(pushJobs);
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Approve").click()`);
        await js(`window.__lore.show("inbox")`);
        await waitFor(`document.querySelector("#content").textContent.includes("approved, not on your store yet")`);
        check("an approval with another draft still waiting puts nothing out yet", !(await js(changes)) && await js(pushJobs) === pushedBefore);
        await js(`[...document.querySelectorAll("#content .irow.step .verb")].find((b) => b.textContent === "Update store").click()`);
        check("Update store asks first, naming the piece going on sale and the new price", await waitFor(`${changes}?.textContent.includes("Going on sale") && ${changes}.textContent.includes("Hire management before rapid growth") && ${changes}.textContent.includes("$0.02 a piece → $0.75 a piece")`), await js(`${changes}?.textContent ?? ""`));
        check("…with Cancel and Confirm, under the store's own heading", await js(`${changes}.getAttribute("aria-label") === "Update your store" && [...${changes}.querySelectorAll("button")].filter((b) => /^(Cancel|Confirm)$/.test(b.textContent)).length === 2`));
        await shot("store-confirm-changes");
        await answerChanges("Cancel");
        check("Cancel closes it and nothing goes out", await waitFor(`!document.querySelector("dialog.changes-sheet[open]")`) && await js(pushJobs) === pushedBefore, String(await js(pushJobs)));
        check("…so the piece still waits for the next update", await js(`window.lore.snapshot().then((s) => s.publications.items.some((i) => i.state === "approved" && i.live === false))`));
        // The staged node answers the ledger query with two sales, one of them the publication just approved.
        const publicId = await js(`window.lore.snapshot().then((s) => s.publications.items.find((i) => i.state === "approved").public_id)`);
        const wrangler = join(process.env.LORE_STORE ?? "", "node_modules/.bin/wrangler");
        mkdirSync(dirname(wrangler), { recursive: true });
        writeFileSync(join(process.env.LORE_STORE ?? "", ".installed"), "");
        const sale = (item_id, title, tx, sold_at) => ({ kind: "publication", item_id, title, price_usd: 0.01, network: "eip155:84532", payer: "0xpayer", tx, sold_at });
        writeFileSync(wrangler, `#!/bin/sh\necho '${JSON.stringify([{ results: [sale(publicId, "Hire management before rapid growth", "0xfeed", "2026-09-02T14:02:00Z"), sale("1111111111111111807ae5f3", "Choosing a co-founder", "0xbeef", "2026-09-01T21:47:00Z")], success: true }])}'\n`, { mode: 0o755 });
        await js(`window.__lore.show("store")`);
        check("the ledger is checked while it loads", await js(`document.querySelector("#content").textContent.includes("Checking your store…")`));
        await waitFor(`document.querySelector("#content").textContent.includes("2 sales")`);
        const store = await js(`document.querySelector("#content").textContent`);
        const hints = await js(`[...document.querySelectorAll("#content .invrow .acts .sub")].map((t) => t.textContent).join("|")`);
        check("the Sales section sums the ledger", store.includes("2 sales · $0.02 · last Sep 2"), store.slice(-200));
        check("each sale links to its transaction, as a Receipt", await js(`[...document.querySelectorAll("#content a.receipt")].map((a) => a.href).join(" ")`) === "https://sepolia.basescan.org/tx/0xfeed https://sepolia.basescan.org/tx/0xbeef");
        check("no hash is spelled out in the row", !store.includes("0xfeed"));
        check("the approved publication counts its sales, on hover", hints.includes("1 sold"), hints);
        check("the Inventory has no monospace", await js(`[...document.querySelectorAll("#content *")].every((n) => !getComputedStyle(n).fontFamily.includes("Mono"))`));
        check("each piece shows its price by the piece", await js(`[...document.querySelectorAll("#content .invrow")].filter((r) => r.dataset.key.startsWith("piece:")).every((r) => r.querySelector(".cost").textContent === "$0.75")`));
        // APP-282, APP-289, from the retired inventory walk (APP-270): a group header reads as a label on its own band, and
        // the rows are the Inbox's size. What Inventory lists, and in what order, is test/unit/renderer-inventory.test.cjs.
        check("a group header reads as a label: medium weight, on its own band, and its rows the Inbox's size", await js(`(() => { const head = getComputedStyle(document.querySelector("#content .igroup")); const row = getComputedStyle(document.querySelector("#content .invrow .say")); return head.fontWeight === "500" && row.fontSize === "13px" && document.querySelector("#content .invrow").getBoundingClientRect().height === 36 && head.backgroundColor !== getComputedStyle(document.querySelector("#content .inv")).backgroundColor; })()`));
        // APP-211, from the retired sales walk (APP-270): sale amounts read in the UI font with even figures.
        const amounts = `[...document.querySelectorAll("#content *")].filter((n) => !n.children.length && /\\$\\d/.test(n.textContent))`;
        check("no sale amount is monospace, and every one has even figures", await js(`${amounts}.length > 2 && ${amounts}.every((n) => !/mono/i.test(getComputedStyle(n).fontFamily) && getComputedStyle(n).fontVariantNumeric.includes("tabular-nums"))`), await js(`${amounts}.map((n) => n.textContent + " " + getComputedStyle(n).fontFamily + " " + getComputedStyle(n).fontVariantNumeric).join(" | ")`));
        await shot("store-sales");
        // From the retired inventory walk (APP-270): Inventory drawn dark, flipped from this light walk.
        await js(`window.lore.setAppearance("dark")`);
        check("switched to dark, Inventory turns at once", await waitFor(`${BG} === ${JSON.stringify(DARK_BG)}`), await js(BG));
        await shot("inventory-rows-dark");
        await js(`window.lore.setAppearance("light")`);
        check("…and back to light", await waitFor(`${BG} === ${JSON.stringify(LIGHT_BG)}`), await js(BG));
        // APP-271: no shot here: Inventory is as store-sales scanned it, light again after the dark one.
        check("the one item not on the store says so on its row, once, and in amber", await js(`[...document.querySelectorAll("#content .invrow .st.wait")].map((st) => st.textContent).join("|")`) === "Pending", await js(`[...document.querySelectorAll("#content .invrow .st")].map((st) => st.textContent).join("|")`));
        await js(`window.__lore.show("settings")`);
        check("Settings offers Update store while an approved item is not live", await waitFor(`[...(${address}?.querySelectorAll("button") ?? [])].some((b) => b.textContent === "Update store")`));
        await js(`window.__lore.show("inbox")`);
        check("Today's next step carries the standing Push", await waitFor(`${nextStep}.includes("1 approved, not on your store yet")`), await js(nextStep));
        // APP-093: a take-down the node has not absorbed yet is pending state read from the snapshot, not a banner.
        // The fake wrangler makes the revoke's push "succeed", which drops the probe cache; re-seed it as a node that still lists the item.
        await js(`window.__lore.show("store")`);
        await waitFor(`document.querySelector("#content").textContent.includes("2 sales")`);
        // APP-282: taking a piece down is in its row's … menu, and asks first.
        await js(`[...document.querySelectorAll("#content .invrow")].find((r) => r.dataset.key.startsWith("piece:") && r.querySelector(".st.sale, .st.wait")).querySelector("[aria-label=More]").click()`);
        check("the row's menu offers Take down", await waitFor(`[...document.querySelectorAll(".inv-menu:popover-open button")].map((b) => b.textContent).join("|") === "Open memory|Set price…|Take down…"`), await js(`[...document.querySelectorAll(".inv-menu button")].map((b) => b.textContent).join("|")`));
        await js(`[...document.querySelectorAll(".inv-menu button")].find((b) => b.textContent === "Take down…").click()`);
        check("take-down confirmation does not promise buyers lose their copies", await waitFor(`document.querySelector("dialog.form-sheet[open]")?.textContent.includes("Anyone who already did keeps their copy.")`));
        await shot("store-take-down");
        await js(`[...document.querySelectorAll("dialog.form-sheet[open] button")].find((b) => b.textContent === "Take down").click()`);
        // The update that takes it down also carries the new price, so the owner confirms that first.
        check("a take-down that also puts out a new price asks about the price", await waitFor(`${changes}?.textContent.includes("$0.02 a piece → $0.75 a piece")`), await js(`${changes}?.textContent ?? ""`));
        await answerChanges("Confirm");
        // APP-271: the take-down is said, which is what the check below reads. This waited ten seconds every run for
        // "Taken down" in the list, which shows only once the folded group is opened below, and went on when it ran out.
        await waitFor(`document.querySelector("#status").textContent.includes("Your store stops selling it as soon as it updates.")`);
        // This scratch home has no node source, so the revoke's push fails: the owner hears that plainly, not as a command.
        const revokeNotice = await js(`document.querySelector("#status").textContent`);
        check("a take-down whose push failed reads plainly", revokeNotice.includes("Your store stops selling it as soon as it updates.") && !/wrangler|--worker-dir|\/Users\/|\/var\//.test(revokeNotice), revokeNotice);
        uvRun(["python", "-c", `import time\nfrom lore.store import Store\nwith Store() as s:\n s.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:84532', 'payout': '0x' + 'a' * 40}, 'ids': ['${publicId}']})`], { cwd: join(__dirname, "../../.."), env: process.env });
        await js(`window.__lore.event({ type: "changed" })`);
        await js(`[...document.querySelectorAll(".ptab")].find((t) => t.textContent.startsWith("Private")).click()`);
        // APP-282: taken-down pieces sit folded at the foot, apart from the live ones; one still on the store says Coming off.
        await waitFor(`[...document.querySelectorAll("#content .igroup .label")].some((l) => l.textContent === "Taken down")`);
        await js(`(() => { const head = [...document.querySelectorAll("#content .igroup")].find((g) => g.querySelector(".label").textContent === "Taken down"); if (head.getAttribute("aria-expanded") === "false") head.click(); })()`);
        check("a taken-down item is private again, under Taken down, and says the store still serves it", await waitFor(`[...document.querySelectorAll("#content .invrow .st")].some((st) => st.textContent === "Coming off")`), await js(`[...document.querySelectorAll("#content .invrow .st")].map((st) => st.textContent).join("|")`));
        check("…and the tabs still add up to All", await js(`(() => { const n = [...document.querySelectorAll(".ptab .n")].map((x) => Number(x.textContent)); return n[0] === n[1] + n[2] + n[3]; })()`), await js(`[...document.querySelectorAll(".ptab")].map((t) => t.textContent).join("|")`));
        await shot("store-removal-pending");
        await js(`window.__lore.show("settings")`);
        check("…and Settings offers the update that removes it", await waitFor(`${address}?.textContent.includes("1 taken down, still on your store") && [...${address}.querySelectorAll("button")].some((b) => b.textContent === "Update store")`), await js(`${address}?.textContent ?? ""`));
        await js(`window.__lore.show("inbox")`);
        check("Today's next step names the pending removal", await waitFor(`${nextStep}.includes("1 taken down, still on your store")`), await js(nextStep));
        // APP-211: the last piece taken down, its removal not on the store yet, and a new price: Update store pushes the removal first.
        const pendingRemoval = () => uvRun(["python", "-c", `import time\nfrom lore.store import Store\nwith Store() as s:\n s.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:84532', 'price_usd': 0.02, 'payout': '0x' + 'a' * 40}, 'ids': ['${publicId}']})`], { cwd: join(__dirname, "../../.."), env: process.env });
        pendingRemoval();
        await js(`window.__lore.event({ type: "changed" })`);
        check("Today's next step counts both changes: the removal still pending and the new price", await waitFor(`snapshot.node.live.price_usd === 0.02 && ${nextStep}.includes("2 changes aren't live yet") && ${nextStep}.includes("1 taken down, still on your store")`), await js(nextStep));
        const todayUpdates = `[...document.querySelectorAll("#content button")].filter((b) => b.textContent === "Update store")`;
        check("Today offers one Update store for it", await js(`${todayUpdates}.length === 1`), String(await js(`${todayUpdates}.length`)));
        let before = ipc.length;
        await js(`${todayUpdates}[0].click()`);
        await until(() => ipc.slice(before).includes("store:push"), 4000);
        check("…which pushes, and starts no deploy", ipc.slice(before).includes("store:push") && !ipc.slice(before).includes("agent:prompt"), JSON.stringify(ipc.slice(before)));
        check("…once the owner confirms the piece coming off and the new price", await waitFor(`${changes}?.textContent.includes("Coming off") && ${changes}.textContent.includes("Hire management before rapid growth") && ${changes}.textContent.includes("$0.02 a piece → $0.75 a piece")`), await js(`${changes}?.textContent ?? ""`));
        await answerChanges("Confirm");
        await waitFor(`!document.querySelector("dialog.changes-sheet[open]")`);
        pendingRemoval();
        await js(`window.__lore.event({ type: "changed" })`);
        await js(`window.__lore.show("settings")`);
        // The push confirmed on Today is still out until its button reads Update store again.
        await waitFor(`${address}?.textContent.includes("taken down, still on your store") && [...${address}.querySelectorAll("button")].some((b) => b.textContent === "Update store" && !b.disabled)`, 80);
        const updates = `[...${address}.querySelectorAll("button, a")].filter((b) => /^(Update store|Updating…)$/.test(b.textContent))`;
        check("a pending removal and a new price: one Update store", await js(`${updates}.length === 1`), String(await js(`${updates}.length`)));
        before = ipc.length;
        await js(`${updates}[0].click()`);
        await until(() => ipc.slice(before).includes("store:push"), 4000);
        check("…which pushes the removal first, not a redeploy", ipc.slice(before).includes("store:push") && !ipc.slice(before).includes("agent:prompt") && await js(`document.querySelector("#title").textContent`) === "Settings", JSON.stringify(ipc.slice(before)));
        await waitFor(changes);
        await answerChanges("Confirm");
        check("…and goes out on Confirm", await waitFor(`!document.querySelector("dialog.changes-sheet[open]")`));
        await shot("store-push-first");
        // APP-290, from the retired inventory walk (APP-270): Record a memory opens a new memory's thread already listening,
        // under Chromium's fake microphone, and Esc stops it, sending nothing. The rest is test/unit/renderer-talk.test.cjs.
        await js(`window.__lore.show("inventory")`);
        await waitFor(`document.querySelector("#title").textContent === "Inventory" && !document.querySelector("#talk").hidden`);
        const talkFrom = ipc.length;
        await js(`document.querySelector("#talk").click()`);
        const listening = `document.querySelector("#composer").dataset.mode === "listening"`;
        check("Record a memory opens a new memory's thread already listening", await waitFor(`document.querySelector("#title").textContent === "Capture a memory" && ${listening}`), await js(`document.querySelector("#title").textContent + " | " + document.querySelector("#dictation").textContent`));
        await shot("talk-listening");
        await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
        check("Esc stops listening and sends nothing", await waitFor(`!document.querySelector("#composer").dataset.mode`) && !ipc.slice(talkFrom).includes("agent:prompt") && !ipc.slice(talkFrom).includes("dictation:transcribe"), JSON.stringify(ipc.slice(talkFrom).filter((channel) => /prompt|dictation/.test(channel))));
        // Back out of the empty thread, so the capture below starts from the Inbox as it did before.
        await js(`closeTask(); true`);
        // APP-271: nothing the thread set off is still out, so the load below is the only one, as its check needs.
        await idle();
        // Fix 9: a new memory joins the unfinished capture thread instead of an empty one.
        await js(`window.__lore.show("inbox")`);
        // A task Lore hears about while a load is out is newer than what that load read from disk: the load landing
        // after it never takes it back. The load's read goes out before the news, so this is the same order every run.
        const unfinished = `{ version: 1, kind: "capture", title: "Capture", state: "stopped", phase: "Reply to keep going", updatedAt: new Date().toISOString() }`;
        await js(`window.__landing = window.__lore.load()`);
        // Lore writes the thread it asked in to disk before it says so (ask()), so any load that starts after the news reads it back.
        const { SessionManager } = await import("@earendil-works/pi-coding-agent");
        const thread = SessionManager.create(process.env.LORE_HOME ?? "", join(process.env.LORE_HOME ?? "", ".pi/sessions/capture"));
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
        thread.appendMessage({ role: "assistant", content: [{ type: "text", text: "What did you learn?" }], api: "lore", provider: "lore", model: "lore", usage, stopReason: "stop", timestamp: Date.now() });
        thread.appendCustomEntry("lore.task", { version: 1, kind: "capture", title: "Capture a memory", state: "stopped", phase: "Reply to keep going" });
        check("a task heard while a load is out outlives that load", await js(`(() => { window.__lore.event({ type: "task", task: ${unfinished} }); return window.__landing; })().then(() => document.querySelector("#content").textContent.includes("Reply to keep going"))`));
        await js(`window.__lore.load()`);
        check("unfinished capture is listed", await js(`document.querySelector("#content").textContent.includes("Reply to keep going")`));
        check("an unfinished thread is one row with one verb, Open", await js(`(() => { const row = [...document.querySelectorAll("#content .irow.task")].find((r) => r.textContent.includes("Reply to keep going")); return Boolean(row) && [...row.querySelectorAll(".btn")].map((b) => b.textContent).join() === "Open"; })()`));
        check("…and the Inbox has no composer of its own", await js(`document.querySelector("#capture").hidden`));
        await js(`document.querySelector("#new-open").click(); document.querySelector("[data-new=memory]").click()`);
        await waitFor(`!document.querySelector("#capture").hidden && document.activeElement?.id === "capture-input"`);
        await js(`const i = document.querySelector("#capture-input"); i.value = "Something I learned"; document.querySelector("#composer").requestSubmit();`);
        const joined = await waitFor(`/Reply to keep going/.test(document.querySelector("#eyebrow").textContent)`);
        const eyebrow = await js(`document.querySelector("#eyebrow").textContent`);
        check("New › Memory joins the unfinished thread", joined, eyebrow);
        await shot("root-capture-joined");
        await js(`window.__lore.openTask("deploy")`);
        const deployLog = await js(`document.querySelector("#log").textContent`);
        check("a completed deploy opens with fresh history", !deployLog.includes("OLD COMPLETED DEPLOY"), deployLog);
        check("drafts stay out of a thread that cannot draft", !(await js(`[...document.querySelectorAll("#main h2")].some((h) => h.textContent === "Approve what to sell")`)));
        // APP-134, from the retired sell walk (APP-270): the way in to selling pasted writing is the New menu, and its sheet
        // is scanned here. What Draft it for sale does is test/unit/renderer-sell.test.cjs.
        await js(`closeTask(); window.__lore.show("inventory"); true`);
        await js(`document.querySelector("#new-open").click()`);
        check("New lists Writing to sell", await waitFor(`[...document.querySelectorAll("#new-menu button")].map((b) => b.textContent).join("|") === "MemoryM|CollectionC|Writing to sellW|AutomationA"`), await js(`[...document.querySelectorAll("#new-menu button")].map((b) => b.textContent).join("|")`));
        await js(`document.querySelector("#new-menu [data-new=writing]").click()`);
        check("Sell something you wrote opens the sheet", await waitFor(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") === "Sell something you wrote" && Boolean(document.querySelector("dialog.sheet[open] textarea"))`), await js(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") ?? "none"`));
        await js(`const t = document.querySelector("dialog.sheet[open] textarea"); t.value = "Our launch deck lost to four-minute demos.\\nTwelve cold sends, zero replies."; t.dispatchEvent(new Event("input"))`);
        await shot("sell-paste");
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        check("…and closes, keeping nothing", await waitFor(`!document.querySelector("dialog.sheet[open]")`) && !(await js(`window.lore.search("four-minute demos").then((found) => found.length > 0)`)));
      } else if (scenario === "connectors") {
        // The catalog drives the surface: three apps of three shapes, none of them special-cased.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        // APP-127, APP-214: an owner with nothing connected is pointed at Connectors, and nothing to publish yet.
        await waitFor(`/Connect the AI you talk to most/.test(document.querySelector("#content").textContent)`, 120);
        const firstToday = await js(`document.querySelector("#content").textContent`);
        check("Today points a new owner at connecting their AI, with nothing to publish yet", /Connect the AI you talk to most/.test(firstToday) && !/something to sell/.test(firstToday), firstToday);
        check("…and names no coding agents", !/Claude Code|Codex/.test(firstToday), firstToday);
        await shot("today-bring-in");
        await js(`document.querySelector("#content .irow.step .verb").click()`);
        check("…and its button opens Connectors", await waitFor(`document.querySelector("#title").textContent === "Connectors"`));
        await js(`document.querySelector("dialog.sheet[open] .icon-btn")?.click()`);
        // Only the rows under "Your apps": Account also says Claude.
        const sourceRows = `[...[...document.querySelectorAll("#content section")].find((s) => s.querySelector("h2")?.textContent === "Your apps").querySelectorAll(".row")]`;
        const rowOf = (name) => `${sourceRows}.find((r) => r.querySelector("b").textContent === ${JSON.stringify(name)})`;
        const textOf = (name) => `(${rowOf(name)}?.textContent ?? "")`;
        const clickOn = (name) => `${rowOf(name)}.querySelector("button").click()`;
        const primary = `document.querySelector("dialog.sheet[open] .btn.primary")`;
        // APP-271: what a closed sheet is waited on by, in place of a fixed wait after each close.
        const noSheet = `!document.querySelector("dialog.sheet[open]")`;
        const apps = JSON.stringify(["Obsidian", "ChatGPT", "Claude", "Google Maps", "Substack", "Medium", "Bluesky", "Blog or newsletter", "Letterboxd", "Goodreads", "Granola", "Notion", "Readwise"]);
        // APP-271: every app's row is drawn and Connectors has stopped asking, in place of a fixed wait after the first.
        await waitFor(`${apps}.every((n) => ${sourceRows}.some((r) => r.querySelector("b").textContent === n))`);
        await idle();
        const offered = await js(`${apps}.map((n) => ${sourceRows}.find((r) => r.querySelector("b").textContent === n)?.textContent ?? "")`);
        check("every app in the catalog is offered by name, in its own words", offered.length === 13 && /Connect/.test(offered[0]) && offered.slice(1, 4).every((t) => /Import/.test(t)) && offered.slice(4, 10).every((t) => /Connect/.test(t)) && offered.slice(10).every((t) => /Sign in/.test(t)) && !offered.some((t) => /folder|source|markdown|feed|rss|url|mcp|oauth|token/i.test(t)), offered.join(" | "));
        check("an agent that is not on this Mac is not offered", await js(`!${sourceRows}.some((r) => /^(Codex|Claude Code)$/.test(r.querySelector("b").textContent))`));
        check("every offered app carries its own mark", await js(`${apps}.every((n) => ${sourceRows}.find((r) => r.querySelector("b").textContent === n)?.querySelector("img.logo"))`));
        await shot("settings-catalog");

        // Obsidian: choose among vaults; a change to a vault that is gone leaves the working one alone.
        await js(clickOn("Obsidian"));
        check("Obsidian offers every vault it knows", await waitFor(`document.querySelectorAll("dialog.sheet[open] .form-option").length === 2`));
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((c) => c.textContent.includes("Edge Vault")).querySelector("input").click()`);
        await js(`${primary}.click()`);
        check("a vault connects and says what it kept", await waitFor(`/Connected/.test(${textOf("Obsidian")}) && /2 notes kept/.test(${textOf("Obsidian")})`), await js(textOf("Obsidian")));
        await js(clickOn("Obsidian"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Change vault").click()`);
        await waitFor(`document.querySelectorAll("dialog.sheet[open] .form-option").length === 2`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((c) => c.textContent.includes("Stale Vault")).querySelector("input").click()`);
        await js(`${primary}.click()`);
        const problem = `(document.querySelector("dialog.sheet[open] .problem")?.textContent ?? "")`;
        check("a change to a vault that is gone is refused in the sheet, by name, and the sheet stays open", await waitFor(`/can't reach Stale Vault/.test(${problem}) && !${primary}.disabled`) && await js(`!document.querySelector("#status .notice.attention")`), await js(problem));
        await shot("obsidian-change-refused");
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await waitFor(noSheet);
        check("…and the working vault stays connected", await waitFor(`/Edge Vault/.test(${textOf("Obsidian")}) && /Connected/.test(${textOf("Obsidian")})`), await js(textOf("Obsidian")));

        // Substack: an address, nothing to browse.
        await js(clickOn("Substack"));
        check("Substack asks for an address and offers no folder", await waitFor(`document.querySelector("dialog.sheet[open] input[type=url]") && ![...document.querySelectorAll("dialog.sheet[open] button")].some((b) => /Choose a/.test(b.textContent))`));
        check("Connect waits for the address", await js(`${primary}.disabled`));
        await js(`{ const f = document.querySelector("dialog.sheet[open] input[type=url]"); f.value = ${JSON.stringify(process.env.LORE_EDGE_NEWSLETTER)}; f.dispatchEvent(new Event("input")); }`);
        await js(`${primary}.click()`);
        check("a newsletter connects and counts posts, not notes", await waitFor(`/Connected/.test(${textOf("Substack")}) && /\\d+ posts? kept/.test(${textOf("Substack")})`), await js(textOf("Substack")));
        check("a connected newsletter still offers another", await js(`${sourceRows}.filter((r) => r.querySelector("b").textContent === "Substack").length`) === 2);
        // CAP-003: what was brought in leads to selling, from the notice and from Manage.
        const sell = "Turn these into something to sell";
        check("after two connects, exactly one notice offers the next step", await js(`[...document.querySelectorAll("#status .notice button")].filter((b) => b.textContent === ${JSON.stringify(sell)}).length`) === 1);
        await shot("connected-next-step");
        await js(clickOn("Substack"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        const manage = await js(`document.querySelector("dialog.sheet[open]").textContent`);
        // AUT-009: with no agent, Lore keeps the reading schedule itself from the start.
        check("with no agent, a newsletter says when Lore reads it, the time a link to the schedule", /new posts every (day|weekday|\w+day) at \d+ [AP]M\./.test(manage) && await js(`Boolean(document.querySelector("dialog.sheet[open] .hint button.inline"))`), manage);
        check("Manage offers the same next step", manage.includes(sell), manage);
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await waitFor(noSheet);

        // The other feed apps: the same field, each with its own words for what it kept.
        const connectAt = async (name, address) => {
          await js(clickOn(name));
          await waitFor(`document.querySelector("dialog.sheet[open] input[type=url]")`);
          await js(`{ const f = document.querySelector("dialog.sheet[open] input[type=url]"); f.value = ${JSON.stringify(address)}; f.dispatchEvent(new Event("input")); }`);
          await js(`${primary}.click()`);
        };
        await connectAt("Medium", `${process.env.LORE_EDGE_NEWSLETTER}medium`);
        check("a Medium profile connects and counts stories", await waitFor(`/Connected/.test(${textOf("Medium")}) && /1 story kept/.test(${textOf("Medium")})`), await js(textOf("Medium")));
        await connectAt("Blog or newsletter", `${process.env.LORE_EDGE_NEWSLETTER}blog`);
        check("any blog connects and counts posts", await waitFor(`/Connected/.test(${textOf("Blog or newsletter")}) && /1 post kept/.test(${textOf("Blog or newsletter")})`), await js(textOf("Blog or newsletter")));
        await connectAt("Bluesky", "https://example.com");
        check("Bluesky asks for a handle and refuses a web address, in the sheet", await waitFor(`/Bluesky handle/.test(${problem})`), await js(problem));
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await waitFor(noSheet);

        // APP-128: a refusal is said in the sheet, in plain words, and the sheet stays open to correct it.
        const offerOf = (name) => `${sourceRows}.find((r) => r.querySelector("b").textContent === ${JSON.stringify(name)} && /Connect/.test(r.querySelector("button").textContent)).querySelector("button").click()`;
        const fillIn = (value) => `{ const f = document.querySelector("dialog.sheet[open] input[type=url]"); f.value = ${JSON.stringify(value)}; f.dispatchEvent(new Event("input")); }`;
        await js(offerOf("Blog or newsletter"));
        check("a feed sheet opens on its address field", await waitFor(`document.activeElement === document.querySelector("dialog.sheet[open] input[type=url]")`));
        await js(fillIn("asdf not a url"));
        await key("keyDown", "Enter");
        check("Enter connects, and what is not an address is refused in the sheet", await waitFor(`${problem} === "That doesn't look like a web address."`), await js(problem));
        check("…with the sheet still open, the address still there, and nothing behind it", await js(`document.querySelector("dialog.sheet[open] input[type=url]")?.value === "asdf not a url" && !document.querySelector("#status .notice.attention")`));
        await shot("error-in-sheet");

        // Closing the sheet while a connect is still reading stops it, and it closes nothing else.
        await js(`document.querySelectorAll("#status .dismiss").forEach((b) => b.click())`);
        await js(fillIn(`${process.env.LORE_EDGE_NEWSLETTER}slow`));
        // APP-271: the sheet takes a new address only once the refused connect has finished with it (connectIn's last
        // load); a Connect pressed before then did nothing, and this part closed a sheet with no connect out at all.
        await waitFor(`${primary} && !${primary}.disabled`);
        const connectFrom = ipc.length;
        const primaryState = await js(`JSON.stringify({ disabled: ${primary}?.disabled, text: ${primary}?.textContent, value: document.querySelector("dialog.sheet[open] input[type=url]")?.value })`);
        await js(`${primary}.click()`);
        // APP-271: closed once the connect is out (the blog behind it takes four seconds to answer), then the connect
        // has come back, stopped, and the app has gone quiet: the moment it could close the sheet opened after it.
        const connecting = await until(() => ipc.slice(connectFrom).includes("sources:connect"), 2000);
        await key("keyDown", "Escape");
        await waitFor(noSheet);
        await js(offerOf("Medium"));
        await waitFor(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") === "Medium"`);
        if (connecting) await until(() => answeredSince("sources:connect", connectFrom), 15_000);
        await idle();
        check("a connect closed mid-read never closes the sheet opened after it", await js(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") === "Medium"`), `${connecting ? "connect went out" : "no connect went out"}; asked ${JSON.stringify(ipc.slice(connectFrom))}; primary was ${primaryState}`);
        check("…and connects nothing", await js(`${sourceRows}.filter((r) => r.querySelector("b").textContent === "Blog or newsletter").length`) === 2 && await js(`!document.querySelector("#status").textContent.includes("is connected")`), await js(`document.querySelector("#status").textContent`));
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await waitFor(noSheet);

        // What Read again found is said, and seen even from the bottom of a long list.
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await js(clickOn("Blog or newsletter"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Read again").click()`);
        check("Read again says what it found", await waitFor(`document.querySelector("#status").textContent.includes("Nothing new.")`), await js(`document.querySelector("#status").textContent`));
        check("…in view, below the header, however far down the owner was", await js(`{ const r = document.querySelector("#status").getBoundingClientRect(); r.top >= document.querySelector("main header").getBoundingClientRect().bottom - 1 && r.bottom <= innerHeight }`));
        await shot("notice-in-view");

        // CAP-009: an app with its own server is one Sign in; its approval page would open in the browser.
        await js(clickOn("Granola"));
        check("Granola offers one Sign in and nothing to type or choose", await waitFor(`${primary}?.textContent === "Sign in to Granola"`) && await js(`!document.querySelector("dialog.sheet[open] input")`));
        const signIn = await js(`document.querySelector("dialog.sheet[open]").textContent`);
        check("…in plain words", /Approve there/.test(signIn) && !/mcp|oauth|token|server/i.test(signIn), signIn);
        // Read in the same turn as the click: the stand-in answers faster than a person would.
        check("…and waits on the browser with a way out", await js(`${primary}.click(); /Waiting for you to approve in your browser/.test(document.querySelector("dialog.sheet[open]")?.textContent ?? "") && [...document.querySelectorAll("dialog.sheet[open] button")].some((b) => b.textContent === "Cancel")`));
        check("signing in connects Granola and keeps its meetings", await waitFor(`/Connected/.test(${textOf("Granola")}) && /2 meetings kept/.test(${textOf("Granola")})`), await js(textOf("Granola")));
        check("…and offers to turn them into something to sell", await js(`[...document.querySelectorAll("#status .notice button")].filter((b) => b.textContent === ${JSON.stringify(sell)}).length`) === 1);
        await shot("granola-connected");
        process.kill(Number(process.env.LORE_EDGE_GRANOLA_PID));
        await js(clickOn("Granola"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        check("Manage never shows where Lore reads it from", !/http|mcp/i.test(await js(`document.querySelector("dialog.sheet[open]").textContent`)));
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Read again").click()`);
        check("when Granola stops answering, its row says so and asks to sign in again", await waitFor(`/Granola didn't answer\\. Sign in again\\./.test(${textOf("Granola")})`), await js(textOf("Granola")));
        await js(clickOn("Granola"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        check("…and Manage offers Sign in again", await js(`[...document.querySelectorAll("dialog.sheet[open] button")].some((b) => b.textContent === "Sign in again")`));
        await shot("granola-signed-out");
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await waitFor(noSheet);

        // An export: a file, brought in once.
        await js(clickOn("ChatGPT"));
        check("an export asks for the file that was downloaded", await waitFor(`/Choose the export/.test(document.querySelector("dialog.sheet[open] p")?.textContent ?? "")`));
        check("…and says where to get it", await js(`document.querySelector("dialog.sheet[open]").textContent.includes("Settings → Data controls → Export data")`));
        await shot("export-how-to");
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Choose a file…").click()`);
        check("the chosen file is offered, selected", await waitFor(`${primary}.disabled === false && document.querySelector("dialog.sheet[open] .form-option input").checked`));
        await js(`${primary}.click()`);
        check("an export imports and says what it kept", await waitFor(`/^ChatGPT2 conversations kept/.test(${textOf("ChatGPT")})`), await js(textOf("ChatGPT")));
        await js(clickOn("ChatGPT"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        check("a connected export is not offered again; a newer one goes through Manage", await js(`${sourceRows}.filter((r) => r.querySelector("b").textContent === "ChatGPT").length`) === 1);
        check("an export is read once: no Read again, and it says so", await js(`![...document.querySelectorAll("dialog.sheet[open] button")].some((b) => b.textContent === "Read again") && /Read once/.test(document.querySelector("dialog.sheet[open]").textContent)`));
        await shot("export-manage");
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await waitFor(noSheet);
        await shot("settings-connected");
        // APP-247: the connectors surfaces in dark, flipped from this light walk as the settings walk does, in place of a
        // second connectors walk launched dark. Each shot runs the layout check at both widths.
        await js(`window.lore.setAppearance("dark")`);
        check("switched to dark, the connectors page turns at once", (await waitFor(`${BG} === ${JSON.stringify(DARK_BG)}`)) && nativeTheme.themeSource === "dark", await js(BG));
        await shot("settings-connected-dark");
        await js(clickOn("ChatGPT"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        await shot("export-manage-dark");
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await waitFor(noSheet);
        await js(`window.lore.setAppearance("light")`);
        check("…and back to light before Today", (await waitFor(`${BG} === ${JSON.stringify(LIGHT_BG)}`)) && nativeTheme.themeSource === "light", await js(BG));
        await js(`window.__lore.show("inbox")`);
        await waitFor(`/Turn what you know into something to sell/.test(document.querySelector("#content").textContent)`);
        const today = await js(`document.querySelector("#content").textContent`);
        check("with apps connected, Today offers to publish and stops asking to connect", /Turn what you know into something to sell/.test(today) && !/Connect the AI you talk to most/.test(today), today);
        await shot("today-publish");
        await js(`window.__lore.show("connectors")`);
        await waitFor(textOf("ChatGPT"));
        await js(clickOn("ChatGPT"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === ${JSON.stringify(sell)}).click()`);
        check("the next step opens the publish thread, starting from that app", await waitFor(`document.querySelector("#title").textContent === "Publish from your Lore" && document.querySelector("#log").textContent.includes("brought in from ChatGPT")`), await js(`document.querySelector("#title").textContent`));
        check("…and the other offers to sell go away", await js(`document.querySelectorAll("#status .notice button.btn").length`) === 0);
        await shot("publish-from-app");
        // APP-211: that clean-up leaves Today's own notice alone: it waits under the thread and is there once it closes.
        check("the automations notice survives selling, hidden while the thread covers Today", await js(`notices.some((n) => n.key === "automations") && !document.querySelector("#status").textContent.includes("Change this in Settings")`));
        // APP-271: what the thread set off has landed before it closes.
        await idle();
        await js(`closeTask(); true`);
        check("…and shows again, once, when Today is back", await waitFor(`[...document.querySelectorAll("#status .notice")].filter((n) => n.textContent.includes("Change this in Settings")).length === 1`), await js(`JSON.stringify({ shown: [...document.querySelectorAll("#status .notice")].map((n) => n.textContent.slice(0, 60)), notices: notices.map((n) => n.key ?? n.text.slice(0, 40)), today: onToday(), view, detailTask })`));
      } else if (scenario === "settings") {
        // Settings → Your store with every row filled, then the batch of free-part updates on Today.
        const text = () => js(`document.querySelector("#content").textContent`);
        const rowOf = (label) => `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector(".t b")?.textContent === ${JSON.stringify(label)})`;
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content .irow.draft")`);
        // APP-126: a downloaded update shows one button by the Lore name, and nothing before it is ready.
        check("no update button until one is ready", await js(`document.querySelector("#update").hidden`));
        await js(`window.__lore.event({ type: "update", update: { version: "0.1.13", state: "ready" } })`);
        check("a ready update shows Update by the Lore name, on one line", await js(`(() => { const b = document.querySelector("#update"); return !b.hidden && b.textContent === "Update" && b.closest(".ws-row") !== null && b.getBoundingClientRect().height === 24; })()`));
        await shot("update-ready");
        const clearOfTitlebar = `(() => { const bar = document.querySelector(".titlebar"); bar.style.pointerEvents = "none"; const hits = []; for (let y = 1; y < 28; y += 3) for (let x = 1; x < innerWidth; x += 8) hits.push(document.elementFromPoint(x, y)?.closest("button, a, input, textarea, select, [tabindex]:not(#main)")); bar.style.pointerEvents = ""; return hits.every((hit) => !hit || getComputedStyle(hit).appRegion === "no-drag"); })()`;
        check("the window drags from a strip across its whole top", await js(`(() => { const bar = document.querySelector(".titlebar"); const r = bar.getBoundingClientRect(); return getComputedStyle(bar).webkitAppRegion === "drag" && r.top === 0 && r.left === 0 && r.width === innerWidth && r.height === 28; })()`));
        check("anything clickable under the drag strip takes clicks, not drags (APP-289)", await js(clearOfTitlebar));
        // A scroll is applied as it is set, and elementFromPoint lays the page out first.
        await js(`document.querySelector("#main").scrollTop = 400`);
        check("…and so does anything that scrolls under it", await js(clearOfTitlebar));
        await js(`[...document.querySelectorAll("#content .memory")].at(-2)?.scrollIntoView({ block: "start" })`);
        await shot("today-approvals");
        await js(`window.__lore.show("settings")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Listed")`);
        // APP-271: Settings' own reads (cards, listing) have landed, in place of a fixed wait.
        await idle();
        await shot("settings-top");
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await shot("settings-your-store");
        const settings = await text();
        check("no network jargon in Settings", !/Base(?![a-z])|mainnet|USDC/.test(settings), settings);
        check("the address row has one Live pill and one Open link", await js(`(() => { const r = ${rowOf("Address")}; return r.querySelector(".status-pill")?.textContent === "Live" && [...r.querySelectorAll("a.link-btn")].map((a) => a.textContent + " " + a.href).join() === "Open ↗ https://lore-edge.example.workers.dev/"; })()`));
        check("one Change control for the price, and no second payouts link", await js(`[...document.querySelectorAll("#content button")].filter((b) => /Change/.test(b.textContent)).length === 1 && ![...document.querySelectorAll("#content a")].some((a) => a.textContent === "Payouts ↗")`));
        check("the price row says the free copies", await js(`${rowOf("Price")}.textContent.includes("$1.00 per piece · first 3 copies free")`));
        check("the store's dashboard is a quiet link beside its address", await js(`[...${rowOf("Address")}.querySelectorAll("a.quiet-link")].map((a) => a.textContent).join("|")`) === "Hosted on Cloudflare ↗");
        check("…and the pieces it hasn't got yet wait on one Update store there", await js(`${rowOf("Address")}.textContent.includes("2 approved, not on your store yet") && [...${rowOf("Address")}.querySelectorAll("button")].filter((b) => b.textContent === "Update store").length === 1`), await js(`${rowOf("Address")}.textContent`));
        // APP-282: Inventory is rows only; each piece says its price in whole dollars and cents, no extra zeros.
        await js(`window.__lore.show("store")`);
        await waitFor(`[...document.querySelectorAll("#content .invrow")].filter((r) => r.dataset.key.startsWith("piece:")).map((r) => r.querySelector(".cost")?.textContent).join("|") === "$1|$1"`);
        const costs = await js(`[...document.querySelectorAll("#content .invrow")].filter((r) => r.dataset.key.startsWith("piece:")).map((r) => r.querySelector(".cost").textContent).join("|")`);
        check("each piece on sale shows its price as $1", costs === "$1|$1", costs);
        check("…and Inventory carries no store card", await js(`!document.querySelector("#content .card")`));
        await shot("store-card");
        await js(`window.__lore.show("settings")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Listed")`);
        const paid = await js(`${rowOf("Get paid")}?.textContent ?? ""`);
        check("Get paid names both ways in, card first", /By card.*agents in a browser.*Stripe.*On.*To your wallet.*0x0c27…8166/.test(paid), paid);
        check("…with the wallet one link away", await js(`[...${rowOf("Get paid")}.querySelectorAll("a.link-btn")].some((a) => a.textContent === "View ↗" && a.href === "https://basescan.org/address/0x0c270534cfcecc9224edb903ef5dd70410d08166")`));
        check("paid answers get their own row", await js(`${rowOf("Paid answers")}?.textContent.includes("$0.10 per answer")`));
        check("the home folder is one click from Finder", await js(`${rowOf("Where it lives")}?.textContent.includes("Show in Finder")`));
        await js(`${rowOf("Price")}.querySelector("button").click()`);
        await waitFor(`Boolean(document.querySelector("dialog.form-sheet[open]"))`);
        check("Change opens one sheet for price and free copies, over Settings", await js(`[...document.querySelectorAll("dialog.form-sheet[open] .form-row")].map((r) => r.querySelector(".form-label").textContent).join("|") === "Price per piece|Free copies" && document.querySelectorAll("dialog.form-sheet[open] input").length === 2 && document.querySelector("#title").textContent === "Settings"`));
        await shot("store-price-sheet");
        // A price asked for on a card is one field in one ring: focus never draws a second box around the digits inside.
        const rings = await js(`{ const box = document.createElement("div"); box.className = "card request"; box.innerHTML = '<div class="price-field"><span class="price-prefix">$</span><input type="text" value="1"></div>'; (document.querySelector("dialog[open] .form-body") ?? document.querySelector("#content")).append(box); const input = box.querySelector("input"); input.focus({ focusVisible: true }); const seen = [getComputedStyle(box.firstChild).boxShadow, getComputedStyle(input).boxShadow, getComputedStyle(input).outlineStyle].join(" | "); box.remove(); seen; }`);
        check("a price field in focus shows one ring, around the field, none around its digits", /^(?!none).+ \| none \| none$/.test(rings), rings);
        await js(`{ const [amount, copies] = document.querySelectorAll("dialog.form-sheet[open] input"); amount.value = "0.75"; copies.value = "5"; amount.form.requestSubmit(); }`);
        check("both save through the CLI", await waitFor(`window.lore.snapshot().then((s) => s.pricing.publication_usd === 0.75 && s.pricing.free_copies === 5)`));
        // APP-226: a live store charges the new price only once the owner confirms it; Cancel leaves Update store waiting.
        const priceChange = `document.querySelector("dialog.changes-sheet[open]")`;
        check("…and a live store asks before it charges the new price", await waitFor(`${priceChange}?.textContent.includes("$1.00 a piece → $0.75 a piece")`), await js(`${priceChange}?.textContent ?? ""`));
        await js(`[...${priceChange}.querySelectorAll("button")].find((b) => b.textContent === "Cancel").click()`);
        check("…and Cancel leaves the update waiting", await waitFor(`!document.querySelector("dialog.changes-sheet[open]") && [...document.querySelectorAll("#content button")].some((b) => b.textContent === "Update store")`));
        await shot("store-price-editor-saved");
        await js(`window.__lore.show("settings")`);
        await waitFor(`${rowOf("Price")}?.textContent.includes("first 5 copies free")`);
        check("Settings shows the version and the same restart", await js(`${rowOf("Lore 0.1.13")}?.textContent.includes("Restart to update")`));
        await js(`window.__lore.event({ type: "update", update: { version: "0.1.13", state: "offline" } })`);
        check("unable to check says so in Settings only", await js(`document.querySelector("#update").hidden && ${rowOf("Lore 0.1.13")}.textContent.includes("couldn't check")`));
        await js(`window.__lore.event({ type: "update", update: { version: "0.1.13", state: "outside", newer: true } })`);
        check("a copy outside Applications offers the move, and Update", await js(`!document.querySelector("#update").hidden && ${rowOf("Lore 0.1.13")}.textContent.includes("Move to Applications")`));
        // shot() lets the Update button's entrance finish and the scroll come to rest before it scans.
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await shot("settings-updates");
        await js(`window.__lore.event({ type: "update", update: { version: "0.1.13", state: "current" } })`);
        // APP-225: Appearance turns the window at once, sidebar material too, and the choice is kept for next launch.
        const looks = () => js(`[...${rowOf("Light or dark")}.querySelectorAll("[role=radio]")].map((b) => b.textContent + (b.getAttribute("aria-checked") === "true" ? "*" : "")).join("|")`);
        const pick = (label) => js(`[...${rowOf("Light or dark")}.querySelectorAll("[role=radio]")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        const kept = () => JSON.parse(readFileSync(join(process.env.LORE_DESKTOP_USER_DATA ?? "", "appearance.json"), "utf8")).appearance;
        /** APP-271: main writes the choice after the window has turned, so its file is waited on (and read again if caught mid-write). @param {string} choice */
        const keptAs = (choice) => until(() => { try { return kept() === choice; } catch { return false; } }, 5000);
        check("Appearance offers Match Mac, Light and Dark, the kept one picked", (await looks()) === (DARK ? "Match Mac|Light|Dark*" : "Match Mac|Light*|Dark"), await looks());
        await pick(DARK ? "Light" : "Dark");
        check(`…and picking ${DARK ? "Light" : "Dark"} turns the window at once`, (await waitFor(`${BG} === ${JSON.stringify(DARK ? LIGHT_BG : DARK_BG)}`)) && nativeTheme.themeSource === (DARK ? "light" : "dark"), await js(BG));
        check("…kept for the next launch", await keptAs(DARK ? "light" : "dark"));
        await js(`${rowOf("Light or dark")}.scrollIntoView({ block: "center" })`);
        await shot(`settings-appearance-${DARK ? "light" : "dark"}`);
        await pick(DARK ? "Dark" : "Light");
        check("…and back", (await waitFor(`${BG} === ${JSON.stringify(DARK ? DARK_BG : LIGHT_BG)}`)) && (await looks()) === (DARK ? "Match Mac|Light|Dark*" : "Match Mac|Light*|Dark"));
        // The account menu's Dark mode switch: one click flips the window, says what it is drawn in, and is kept.
        const switchOn = () => js(`document.querySelector("#dark-mode").getAttribute("aria-checked")`);
        await js(`document.querySelector("#account").click()`);
        // The switch follows the theme's change event, a beat after the window repaints, so both are waited on together.
        check("the account menu's Dark mode switch shows the window's theme", await waitFor(`document.querySelector("#account-menu").matches(":popover-open") && document.querySelector("#dark-mode").getAttribute("aria-checked") === ${JSON.stringify(String(DARK))}`), await switchOn());
        await shot(`account-menu-dark-mode-${DARK ? "on" : "off"}`);
        await js(`document.querySelector("#dark-mode").click()`);
        check("…one click flips the window at once, the menu still open", (await waitFor(`${BG} === ${JSON.stringify(DARK ? LIGHT_BG : DARK_BG)} && document.querySelector("#dark-mode").getAttribute("aria-checked") === ${JSON.stringify(String(!DARK))}`)) && await js(`document.querySelector("#account-menu").matches(":popover-open")`), await js(BG));
        await shot(`account-menu-dark-mode-${DARK ? "off" : "on"}`);
        const { Appearance } = require(join(src, "appearance.cjs"));
        check("…kept as an explicit choice the next launch reads", (await keptAs(DARK ? "light" : "dark")) && (await new Appearance(join(process.env.LORE_DESKTOP_USER_DATA ?? "", "appearance.json"), { themeSource: "system" }).read()) === (DARK ? "light" : "dark"));
        await js(`document.querySelector("#account-menu").hidePopover()`);
        check("…and Settings shows it", (await looks()) === (DARK ? "Match Mac|Light*|Dark" : "Match Mac|Light|Dark*"), await looks());
        check("…and the page reads it back as a new launch would", (await js(`window.lore.appearance()`)) === (DARK ? "light" : "dark"));
        await js(`document.querySelector("#account").click()`);
        await js(`document.querySelector("#dark-mode").click()`);
        await js(`document.querySelector("#account-menu").hidePopover()`);
        check("…and flips back", await waitFor(`${BG} === ${JSON.stringify(DARK ? DARK_BG : LIGHT_BG)}`));

        // APP-283: the Inbox says the updates are ready; Review opens them where they are approved.
        await js(`window.__lore.show("inbox")`);
        const updatesRow = `[...document.querySelectorAll("#content .irow.draft")].find((r) => r.textContent.includes("Ready to approve: new free parts for 2 pieces on sale"))`;
        check("the Inbox lists the updates as one row", await waitFor(updatesRow), await js(`document.querySelector("#content").textContent`));
        await js(`${updatesRow}.querySelector(".verb").click()`);
        await waitFor(`document.querySelector("#content").textContent.includes("already for sale")`);
        const batch = `document.querySelector("#content .extras-batch")`;
        check("one header names the batch", await js(`${batch}?.querySelector(".batch-head b")?.textContent`) === "Add who-it's-for lines and samples to 2 pieces already for sale");
        check("the cards read like the buyer page, with no fields showing", await js(`[...${batch}.querySelectorAll(".fields")].every((f) => f.hidden) && ${batch}.textContent.includes("Good for") && ${batch}.textContent.includes("Not for")`));
        check("a sample shows only where there is one", await js(`${batch}.querySelectorAll(".read-sample").length === 1`));
        check("the old per-card disclaimer is gone", !(await text()).includes("Already for sale. Approving changes"));
        await js(`${batch}.scrollIntoView({ block: "start" })`);
        await shot("today-extras-batch");
        await js(`[...[...${batch}.querySelectorAll(".memory")][1].querySelectorAll("button")].find((b) => b.textContent === "Edit").click()`);
        check("Edit swaps in the three free fields", await js(`(() => { const m = [...${batch}.querySelectorAll(".memory")][1]; return !m.querySelector(".fields").hidden && m.querySelector(".read").hidden && m.querySelectorAll(".fields textarea").length === 3; })()`));
        await js(`{ const t = [...${batch}.querySelectorAll(".memory")][1].querySelectorAll("textarea")[1]; t.value = "you have no buyers yet"; t.dispatchEvent(new Event("input")); }`);
        await shot("today-extras-editing");
        await js(`[...${batch}.querySelectorAll("button")].find((b) => b.textContent === "Approve all 2").click()`);
        check("Approve all asks once before acting", await js(`${batch}.textContent.includes("Approve all 2?")`) && await js(`window.lore.extras().then((left) => left.length)`) === 2);
        check("…with every confirm button inside the card", await js(`(() => { const edge = ${batch}.getBoundingClientRect().right; return [...${batch}.querySelectorAll(".batch-head button")].every((b) => b.getBoundingClientRect().right <= edge); })()`));
        await shot("today-extras-confirm");
        await js(`[...${batch}.querySelectorAll("button")].find((b) => b.textContent === "Approve both").click()`);
        check("approving all consumes every update", await waitFor(`window.lore.extras().then((left) => !left.length)`));
        // APP-226: the update that carries them waits on the owner's Confirm, naming both pieces.
        const changes = `document.querySelector("dialog.changes-sheet[open]")`;
        check("…and the store update names both pieces before it goes out", await waitFor(`${changes}?.textContent.includes("Live demos beat cold decks") && ${changes}.textContent.includes("Raise prices after the tenth buyer")`), await js(`${changes}?.textContent ?? ""`));
        await js(`[...${changes}.querySelectorAll("button")].find((b) => b.textContent === "Confirm").click()`);
        check("…carrying the edit made on the card", /Not useful if: you have no buyers yet|not useful if: you have no buyers yet/i.test(uvRun(["lore", "publication", "list"], { cwd: join(__dirname, "../../.."), env: process.env, encoding: "utf8" })));
        check("…and says how the store update went, once it has", await waitFor(`/have their new pages|go live with your next store update/.test(document.body.textContent) && !document.body.textContent.includes("updating your store. It takes")`), await js(`document.querySelector("#status").textContent`));
        check("…and leaves the new drafts alone", await js(`window.lore.candidates().then((left) => left.length)`) === 2);
        await shot("today-extras-approved");
        // APP-058: someone signed in before usage events existed hears about them once, then can turn them off.
        check("the usage notice is said once, before anything is sent", await js(`window.lore.snapshot().then((s) => s.setup.telemetry_noticed === true)`));
        await js(`window.__lore.show("settings")`);
        const usage = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Anonymous usage"))`;
        check("Settings shows the usage switch, on", await waitFor(`${usage}?.textContent.includes("On")`));
        await js(`[...${usage}.querySelectorAll("button")].find((b) => b.textContent === "Turn off").click()`);
        check("…and turns it off", await waitFor(`window.lore.snapshot().then((s) => s.setup.telemetry_enabled === false)`));
        await shot("settings-usage-off");
        // APP-270: Settings' Activity section, scanned here since the jobs and sales walks went. What its rows say is
        // test/unit/renderer-activity.test.cjs.
        const activity = `[...document.querySelectorAll("#content .section")].find((s) => s.querySelector("h2")?.textContent === "Activity")`;
        check("Settings ends on Activity", await waitFor(`Boolean(${activity}) && document.querySelector("#content").lastElementChild.querySelector("h2")?.textContent === "Activity"`), await js(`[...document.querySelectorAll("#content .section h2")].map((h) => h.textContent).join("|")`));
        await js(`${activity}.scrollIntoView({ block: "start" })`);
        await shot("settings-activity");
      } else if (scenario === "firstrun") {
        // APP-215: a new owner signs in and Lore starts the chat itself: Grok Bot connected in two answers, apps found
        // on this Mac connected in one tap, the first save shown with See them, a relaunch picking up where it was.
        const agentUrl = `${process.env.LORE_EDGE_AGENT_URL}/agent`;
        /** One JSON-RPC call to the stand-in node's /agent, as Grok makes it. @param {string} key @param {string} method @param {object} [params] */
        const call = (key, method, params = {}) => fetch(agentUrl, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        // What the chat shows; each line's speaker, said only to a screen reader, is checked on its own.
        const chat = `(() => { const shown = document.querySelector("#content .first-run")?.cloneNode(true); for (const said of shown?.querySelectorAll(".sr-only") ?? []) said.remove(); return shown?.textContent ?? ""; })()`;
        const tap = (label) => js(`[...document.querySelectorAll("#content .first-run button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        const ask = "Add this MCP server to my account: ";
        const copyMessage = async () => {
          const before = copied.length;
          await js(`document.querySelector("#content .first-run .agent-link").click()`);
          await until(() => copied.length > before, 1000);
          return copied.at(-1) ?? "";
        };
        const signIn = async () => {
          await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
          await js(`window.__lore.signIn()`);
        };
        const relaunch = async () => {
          await new Promise((loaded) => { window.webContents.once("did-finish-load", () => loaded(undefined)); window.webContents.reload(); });
          await signIn();
        };
        const kept = () => js(`window.lore.firstRun()`);
        let answers = 0;
        installedApps = ["grok"];
        // Before Lore has read where the first run stands, a refresh starts nothing: the read, answered from before any
        // write, comes back only after one.
        const letRead = holdAnswer("firstrun:read");
        await signIn();
        // These three are the time the app is given to start the chat too early, which it must not: there is nothing to
        // wait on but time (the held read keeps a call out, so the app never goes quiet).
        await sleep(800);
        await js(`window.__lore.event({ type: "changed" })`);
        await sleep(1500);
        const early = await js(`document.querySelector("#title").textContent === "Welcome to Lore"`);
        if (early) await js(`document.querySelector("#first-run-skip").click()`);
        await sleep(500);
        letRead();
        check("nothing starts before Lore has read where the first run stands", !early, `started early; then ${JSON.stringify(await kept())}`);

        const offer = "First, I found these on this Mac. Connect them, and Lore reads them in a few seconds.";
        check("right after sign-in, Lore opens the chat itself, speaks first, and offers what it found on this Mac", await waitFor(`document.querySelector("#title").textContent === "Welcome to Lore" && ${chat}.startsWith(${JSON.stringify(`Hi, I'm Lore. I keep what you teach your AIs here on this Mac, so every one of them can use it.${offer}`)})`, 80), await js(chat));
        check("…each ticked, Obsidian's vault and Claude Code's notes, before any agent is asked about", await js(`[...document.querySelectorAll("#content .first-run input[type=checkbox]")].every((t) => t.checked)`) && /Obsidian · Edge Vault/.test(await js(chat)) && /Claude Code/.test(await js(chat)) && !(await js(chat)).includes("Which AI do you talk to most?"), await js(chat));
        check("…with Skip for now there, and no capture box or Today notices over it", await js(`!document.querySelector("#first-run-skip").hidden && document.querySelector("#capture").hidden && !document.querySelector("#status .notice")`));
        check("…and where it stands is kept", await waitFor(`window.lore.firstRun().then((k) => k?.state === "started")`), JSON.stringify(await kept()));
        check("…each of Lore's lines names its speaker to a screen reader", await js(`[...document.querySelectorAll("#content .first-run > .line")].every((line) => line.querySelector(":scope > .sr-only")?.textContent === "Lore: ")`));
        await shot("firstrun-greeting");
        // The first try can read neither: this Mac hasn't let Lore into the vault or Claude Code's notes yet. Each answers
        // that it needs access, rather than failing outright.
        const denied = [join(S, "Edge Vault"), join(S, "claude", "projects")];
        for (const folder of denied) chmodSync(folder, 0o000);
        await tap("Connect these");
        check("a connect macOS keeps out keeps its apps, ticked, says why, and offers System Settings and another try", await waitFor(`${chat}.includes("macOS hasn't let Lore read Obsidian and Claude Code. Allow Lore in System Settings, then try again.")`, 80) && await js(`[...document.querySelectorAll("#content .first-run input[type=checkbox]")].filter((t) => t.checked).length === 2 && ["Open System Settings", "Try again"].every((label) => [...document.querySelectorAll("#content .first-run button")].some((b) => b.textContent === label))`), await js(chat));
        check("…and never says anything came in that could not", !/came in|reading them now/.test(await js(chat)), await js(chat));
        // A vault Lore knows, even unread, is connected: what Lore then does on its own is said once, quietly, in the chat.
        check("…and what Lore then does on its own is one quiet line in the chat, not a notice over it", await waitFor(`${chat}.includes("Change this in Settings.")`) && await js(`!document.querySelector("#status .notice")`) && await waitFor(`window.lore.snapshot().then((s) => s.setup.automations_noticed === true)`), await js(chat));
        await shot("firstrun-apps-failed");
        await tap("Try again");
        check("…and trying again before access is granted says so again", await waitFor(`!document.querySelector("#content .first-run .btn.primary[disabled]") && ${chat}.includes("macOS hasn't let Lore read Obsidian and Claude Code.")`, 80), await js(`document.querySelector("#title").textContent + " | " + document.querySelector("#content").textContent`));
        // Lore quits before access is granted: after a relaunch both are still on offer, Lore knowing them already.
        await relaunch();
        check("after a relaunch, what didn't connect is still on offer, first", await waitFor(`${chat}.includes(${JSON.stringify(offer)}) && /Obsidian · Edge Vault/.test(${chat}) && /Claude Code/.test(${chat})`, 80), await js(chat));
        // Access granted: Connect reads each again, the vault Lore already knows included.
        for (const folder of denied) chmodSync(folder, 0o755);
        await tap("Connect these");
        check("trying again connects them all, and says what came in once it's in", await waitFor(`/Connected Obsidian and Claude Code\\. \\d+ memor(y|ies) came in\\./.test(${chat})`, 120) && await js(`window.lore.snapshot().then((s) => s.library.sources.filter((x) => x.enabled && !x.connector || x.connector === "obsidian").length === 2)`), await js(chat));
        check("…then asks which AI the owner talks to most", await waitFor(`${chat}.includes("Which AI do you talk to most?") && document.querySelector("#content .first-choices")`), await js(chat));
        check("…and nothing is said over the chat as a notice", await js(`!document.querySelector("#status .notice")`), await js(`document.querySelector("#status").textContent`));
        await shot("firstrun-apps-connected");

        const picks = await js(`[...document.querySelectorAll("#content .first-choices .choice")].map((c) => c.textContent)`);
        check("…offering the AI the owner talks to, the one on this Mac first, and not Codex again once it's read", JSON.stringify(picks) === JSON.stringify(["Grok BotOn this Mac", "ChatGPT", "Claude", "Instinct", "None of these"]), JSON.stringify(picks));
        check("…the only one found already picked, Muse isn't offered", await js(`document.querySelector("#content .first-choices .choice.picked")?.textContent === "Grok BotOn this Mac" && ![...document.querySelectorAll("#content .first-choices .choice")].some((c) => c.textContent.startsWith("Muse"))`));
        await shot("firstrun-pick");
        storeUnreachable = true;
        await js(`[...document.querySelectorAll("#content .first-choices .choice")].find((c) => c.textContent.startsWith("Grok Bot")).click()`);
        answers++;
        check("with no store online, Grok Bot gets a private place online, sealed for this Mac, with nothing on sale, and the owner free to leave", await waitFor(`${chat}.includes("Grok Bot works online, so Lore keeps a private place online for it to save to. What Grok Bot saves is sealed so only this Mac can read it, and nothing goes on sale. Your key stays on this Mac, and you can move to your own Cloudflare whenever you like.")`), await js(chat));
        check("…and the owner's answer, a pill, says who gave it to a screen reader", await js(`document.querySelector("#content .first-run .line.owner > .sr-only")?.textContent === "You: "`));
        const buttons = `[...document.querySelectorAll("#content .first-run button")].map((b) => b.textContent)`;
        check("…a place that can't be reached says why, with Try again, and no sign-in anywhere", await waitFor(`${chat}.includes("Lore couldn't put your store online: yourlore.dev didn't answer (offline)") && ${buttons}.includes("Try again")`, 60) && !/sign in|free on Cloudflare/i.test(await js(chat)) && opened.length === 0, await js(chat));
        await shot("firstrun-store");
        storeUnreachable = false;
        await tap("Try again");
        answers++;
        check("trying again puts it online and goes straight on to the link", await waitFor(`document.querySelector("#content .first-run .agent-link")`, 80) && JSON.stringify(storeOnlineCalls) === JSON.stringify([true, false]), JSON.stringify(storeOnlineCalls));
        const message = await copyMessage();
        const linked = new RegExp(`^${(ask + agentUrl).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/lore_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$`);
        check("Grok Bot's message to paste is in the chat two answers after it is asked about", answers === 2 && linked.test(message), `${answers} answers; ${message}`);
        check("…with Grok Bot's steps as one line, Open Grok Bot, and the live wait", await js(`document.querySelector("#content .first-run .first-steps")?.textContent`) === "Copy this message and paste it into a Grok Bot chat." && (await js(chat)).includes("Waiting for Grok Bot's first save…") && await js(`[...document.querySelectorAll("#content .first-run button")].some((b) => b.textContent === "Open Grok Bot")`), await js(chat));
        await tap("Open Grok Bot");
        check("Open Grok Bot opens it", await waitFor(`true`) && launched.includes("grok"), JSON.stringify(launched));
        check("…and the store is online for agents, nothing for sale", await js(`window.lore.snapshot().then((s) => Boolean(s.node.url) && !s.node.selling)`));
        check("…and the wait shimmers while it waits", await js(`[...document.querySelectorAll("#content .first-run .agent-wait .shimmer")].some((n) => n.textContent === "Waiting for Grok Bot's first save…" && ${animating("n", "shimmer")})`));
        await shot("firstrun-connect");

        // Lore quits before Grok Bot saves: the chat comes back where it was, with a new link a tap away.
        await relaunch();
        check("a relaunch resumes the chat, still waiting on Grok Bot", await waitFor(`document.querySelector("#title").textContent === "Welcome to Lore" && ${chat}.includes("Waiting for Grok Bot's first save…")`, 80) && (await js(chat)).includes("Grok Bot's link was shown once. Get a new one here if you need it."), await js(chat));
        await shot("firstrun-resumed");
        // One new link at a time: a second tap while the first is on its way does nothing.
        const keyCalls = () => ipc.filter((channel) => channel === "agents:key").length;
        const letKey = hold("agents:key");
        const keysBefore = keyCalls();
        await tap("Get a new link");
        await until(() => keyCalls() > keysBefore, 2000);
        await tap("Get a new link");
        // The time a second ask would take to go out, which it must not.
        await sleep(300);
        check("Get a new link waits for the link it asked for, and asks once", keyCalls() === keysBefore + 1 && await js(`[...document.querySelectorAll("#content .first-run button")].find((b) => b.textContent === "Get a new link")?.disabled === true`), String(keyCalls() - keysBefore));
        letKey();
        check("…and Get a new link shows a new message to paste", await waitFor(`document.querySelector("#content .first-run .agent-link")`, 80));
        const again = await copyMessage();
        check("…with a different key", linked.test(again) && again !== message, again);
        const key = again.slice(ask.length + agentUrl.length + 1);

        const stored = await (await call(key, "tools/call", { name: "store", arguments: { items: [
          { title: "How I price sync placements", content: "I charge by the audience the placement reaches, not by the hours it took.", key: "sync-pricing", kind: "preference" },
          { title: "Quote sync fees in the buyer's currency", content: "Buyers sign faster when the fee is already in their currency.", key: "sync-currency", kind: "preference" },
          { title: "Send the cue sheet with the invoice", content: "Payment comes faster when the cue sheet goes with the invoice.", key: "cue-sheet", kind: "preference" }
        ] } })).json();
        check("Grok Bot's first save reaches the store", stored.result?.isError === false, JSON.stringify(stored));
        const savedCard = `document.querySelector("#content .first-saved")`;
        check("the chat shows it: Grok Bot saved 3 memories, with See them", await waitFor(`(${savedCard}?.textContent ?? "").startsWith("Grok Bot saved 3 memoriesSee them →")`, 120), await js(chat));
        check("…each of its titles first, with Grok Bot's mark", await waitFor(`[...${savedCard}.querySelectorAll(".row")].slice(1, 4).every((r) => r.querySelector("img.logo")?.src.endsWith("assets/grok.svg"))`, 40) && /How I price sync placements/.test(await js(`${savedCard}.textContent`)), await js(`${savedCard}?.textContent ?? ""`));
        check("…counting what the apps on this Mac brought in too, after the relaunch as well", /brought in \d+ memor(y|ies) too\./.test(await js(`${savedCard}.querySelector(".first-saved-apps")?.textContent ?? ""`)) && /Claude Code/.test(await js(`${savedCard}.querySelector(".first-saved-apps").textContent`)), await js(`${savedCard}?.textContent ?? ""`));
        check("…and the first run is done", await waitFor(`window.lore.firstRun().then((k) => k?.state === "done")`), JSON.stringify(await kept()));
        check("…each step it passed reported once, in order, never the failed tries", JSON.stringify(steps) === JSON.stringify(["apps", "agent", "store", "link", "saved"]), JSON.stringify(steps));
        check("…and nothing shimmers once it has saved", await js(`!document.querySelector("#content .first-run .shimmer")`));
        // APP-230: the message it was sent already set up its routine, so the first run ends on the next AI or Today.
        check("…without asking a second time for the routine", !(await js(chat)).includes("routine"), await js(chat));
        check("…and ends on Connect another AI beside Go to Inbox", await js(`[...document.querySelectorAll("#content .first-run-actions button")].map((b) => b.textContent).join("|")`) === "Connect another AI|Go to Inbox", await js(`document.querySelector("#content .first-run-actions")?.textContent ?? ""`));
        await shot("firstrun-saved");
        await js(`[...${savedCard}.querySelectorAll("button.inline")].find((b) => b.textContent === "See them →").click()`);
        const chip = `document.querySelector(".source-filter")?.textContent ?? ""`;
        check("See them lands on Inventory, with everything that came in", await waitFor(`document.querySelector("#title").textContent === "Inventory" && !(${chip})`), await js(chip));
        check("…what Grok Bot saved and what the apps brought in", await waitFor(`[...document.querySelectorAll("#content .invrow .say")].some((b) => b.textContent.startsWith("Send the cue sheet with the invoice")) && [...document.querySelectorAll("#content .invrow .say")].some((b) => b.textContent.startsWith("Ship the smallest change"))`), await js(`[...document.querySelectorAll("#content .invrow .say")].map((b) => b.textContent).join("|")`));
        await shot("firstrun-see-them");
        await relaunch();
        check("once done, a relaunch opens on the Inbox", await waitFor(todayShown, 80) && await js(`document.querySelector("#title").textContent === "Inbox" && document.querySelector("#first-run-skip").hidden`), await js(`document.querySelector("#title").textContent`));

        // Skip for now: the chat steps aside for Today's one next step, and stays aside.
        await js(`window.lore.setFirstRun({ state: "started" })`);
        await relaunch();
        check("a chat not finished opens again", await waitFor(`document.querySelector("#title").textContent === "Welcome to Lore"`, 80));
        await js(`document.querySelector("#first-run-skip").click()`);
        check("Skip for now lands on Today with its one next step", await waitFor(`document.querySelector("#title").textContent !== "Welcome to Lore" && document.querySelectorAll("#content .irow.step").length === 1`), await js(`document.querySelector("#content").textContent`));
        check("…and is kept as skipped", await waitFor(`window.lore.firstRun().then((k) => k?.state === "skipped")`), JSON.stringify(await kept()));
        check("…and reported as skipped", steps.at(-1) === "skipped", JSON.stringify(steps));
        await shot("firstrun-skipped-today");
        await relaunch();
        check("…so a relaunch stays on Today", await waitFor(todayShown, 80) && await js(`document.querySelector("#title").textContent !== "Welcome to Lore"`));
        // Where the first run stands never answers: Lore goes on without it after a moment.
        const letStuck = hold("firstrun:read");
        await relaunch();
        check("a first-run read that never answers holds Today back only a moment", await waitFor(todayShown, 40) && await js(`document.querySelector("#title").textContent !== "Welcome to Lore"`), await js(`document.querySelector("#title").textContent`));
        letStuck();

        // Skip while a step is still under way: what finishes after it never brings the chat back, or goes on to connect.
        const stayedSkipped = async () => {
          // APP-271: what the step let go has finished and the app has gone quiet, in place of two seconds.
          await idle();
          return (await kept())?.state === "skipped" && await js(`document.querySelector("#title").textContent !== "Welcome to Lore" && document.querySelector("#first-run-skip").hidden`);
        };
        const connects = () => ipc.filter((channel) => channel === "agents:connect").length;
        // With everything on this Mac already read, the chat goes straight to the agent.
        const picker = () => waitFor(`document.querySelector("#content .first-choices")`, 80);
        await js(`window.lore.setFirstRun({ state: "started" })`);
        await relaunch();
        check("with nothing new on this Mac, the chat asks about the agent first", await picker() && !(await js(chat)).includes("I found these on this Mac"), await js(chat));
        const letConnect = hold("agents:connect");
        await js(`[...document.querySelectorAll("#content .first-choices .choice")].find((c) => c.textContent.startsWith("ChatGPT")).click()`);
        await waitFor(`${chat}.includes("Getting ChatGPT's link…")`);
        await js(`document.querySelector("#first-run-skip").click()`);
        letConnect();
        check("a Skip while the link is on its way stays a Skip once it arrives", await stayedSkipped(), `${JSON.stringify(await kept())} | ${await js(`document.querySelector("#title").textContent`)}`);

        // Skip while Codex, new on this Mac, is being switched on: it is not read after the owner left.
        mkdirSync(join(S, "codex", "memories"), { recursive: true });
        writeFileSync(join(S, "codex", "memories", "MEMORY.md"), "# Ship small\n\nOne working path beats three half-built ones, every time I have tried both.\n");
        await js(`window.lore.setFirstRun({ state: "started" })`);
        await relaunch();
        check("Codex, now on this Mac, is offered first", await waitFor(`${chat}.includes(${JSON.stringify(offer)}) && ${chat}.includes("Codex")`, 80), await js(chat));
        const reads = () => ipc.filter((channel) => channel === "sources:read").length;
        const letSwitch = hold("sources:switch");
        await tap("Connect");
        const readsBefore = reads();
        await js(`document.querySelector("#first-run-skip").click()`);
        letSwitch();
        check("a Skip while an app is being switched on reads nothing after it", await stayedSkipped() && reads() === readsBefore, `${reads() - readsBefore} reads after`);

        // A link that didn't come: Try again asks once, however often it's tapped, and nothing else can be picked meanwhile.
        await js(`window.lore.setFirstRun({ state: "started" })`);
        await relaunch();
        await picker();
        failOnce.add("agents:connect");
        await js(`[...document.querySelectorAll("#content .first-choices .choice")].find((c) => c.textContent.startsWith("ChatGPT")).click()`);
        check("a link that didn't come says so, with Try again and Choose another", await waitFor(`${chat}.includes("Try again") && ${chat}.includes("Choose another")`), await js(chat));
        const askedBefore = connects();
        const letRetry = hold("agents:connect");
        await tap("Try again");
        await until(() => connects() > askedBefore, 2000);
        const offered = await js(`[...document.querySelectorAll("#content .first-run button")].filter((b) => !b.disabled).map((b) => b.textContent)`);
        await js(`[...document.querySelectorAll("#content .first-run button")].find((b) => b.textContent === "Try again")?.click()`);
        // The time a second ask would take to go out, which it must not.
        await sleep(300);
        check("…Try again asks once, its error gone while it does, and nothing else can be chosen meanwhile", connects() === askedBefore + 1 && !offered.includes("Choose another") && !offered.includes("Try again") && (await js(chat)).includes("Getting ChatGPT's link…"), `${connects() - askedBefore} asks; ${JSON.stringify(offered)}`);
        letRetry();
        check("…and the link it asked for is the one shown", await waitFor(`document.querySelector("#content .first-run .agent-link")`, 80));
        uvRun(["python", "-c", "from lore.store import Store\nwith Store() as s:\n s.set_setting('node_url', None)"], { cwd: join(__dirname, "../../.."), env: process.env });
        await js(`window.lore.setFirstRun({ state: "started" })`);
        await relaunch();
        await picker();
        const letOnline = hold("store:online");
        const connectsBefore = connects();
        await js(`[...document.querySelectorAll("#content .first-choices .choice")].find((c) => c.textContent.startsWith("Claude")).click()`);
        await waitFor(`${chat}.includes("Setting it up…")`);
        await js(`document.querySelector("#first-run-skip").click()`);
        letOnline();
        check("a Skip while the store goes online stays a Skip, and connects nothing after it", await stayedSkipped() && connects() === connectsBefore, `${JSON.stringify(await kept())}; ${connects() - connectsBefore} connects after`);
      } else if (scenario === "agents") {
        // APP-207: connect Grok with no store online yet, hear its first save, and manage it from Connectors.
        const agentUrl = `${process.env.LORE_EDGE_AGENT_URL}/agent`;
        /** One JSON-RPC call to the stand-in node's /agent, as Grok makes it. @param {string} key @param {string} method @param {object} [params] */
        const call = (key, method, params = {}) => fetch(agentUrl, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
        const sheet = `(document.querySelector("dialog.sheet[open]")?.textContent ?? "")`;
        const primary = `document.querySelector("dialog.sheet[open] .btn.primary")`;
        const press = (label) => js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        const agentsSection = `[...document.querySelectorAll("#content section")].find((s) => s.querySelector("h2")?.textContent === "Your agents")`;
        const agentRow = (name) => `[...(${agentsSection}?.querySelectorAll(".row") ?? [])].find((r) => r.querySelector("b").textContent === ${JSON.stringify(name)})`;
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        // APP-214: Claude Code is on this Mac, but Today asks only for the owner's own AI, and never names coding agents.
        const todayText = `document.querySelector("#content").textContent`;
        check("Today's one next step is to connect the owner's AI", await waitFor(`(document.querySelector("#content .irow.step")?.textContent ?? "").includes("Connect the AI you talk to most")`) && !/Claude Code|Codex/.test(await js(todayText)), await js(todayText));
        await js(`window.__lore.show("connectors")`);
        check("Connectors has a group for the owner's agents, offering to connect one", await waitFor(`${agentRow("Connect an agent")}?.querySelector("img.logo")`));
        check("…and the catalog offers no generic Personal agent", !(await js(`[...document.querySelectorAll("#content .row b")].some((b) => b.textContent === "Personal agent")`)));
        await shot("agents-offer");

        // XC-088: no store online, and no step for it: the sheet goes straight to picking, and Connect puts it online.
        installedApps = ["grok", "claude"];
        await js(`${agentRow("Connect an agent")}.querySelector("button").click()`);
        check("with no store online, the sheet goes straight to which agent, with no Cloudflare step and the owner free to leave", await waitFor(`${sheet}.includes("Which agent should save to Lore?")`, 80) && (await js(sheet)).includes("you can move to your own Cloudflare whenever you like") && !/sign in to Cloudflare|free on Cloudflare|Put your store online/i.test(await js(sheet)), await js(sheet));
        const picks = await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].map((o) => o.textContent)`);
        check("…offering each of the six, each with its mark, Muse as coming soon", JSON.stringify(picks) === JSON.stringify(["Grok Bot", "MuseComing soon", "ChatGPT", "Claude", "Instinct", "Other"]) && await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].every((o) => o.querySelector("img.logo"))`), JSON.stringify(picks));
        check("Connect waits for a choice", await js(`${primary}.disabled`));
        // APP-217: Muse can't be chosen, and nothing mints a key for it, not even a call past the sheet.
        const keys = async () => (await js(`window.lore.agents()`)).length;
        const keysBefore = await keys();
        // A click on a disabled choice is handled, or not, before click() returns.
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent.startsWith("Muse")).click()`);
        check("Muse can't be picked, so Connect still waits", await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent.startsWith("Muse")).querySelector("input").disabled && ${primary}.disabled`));
        await shot("agents-muse-soon");
        const refused = await js(`window.lore.connectAgent({ app: "muse", name: "Muse" }).then(() => "connected", (error) => error.message)`);
        check("…a Muse connect is refused, and mints no key", /Choose an agent/.test(refused) && (await keys()) === keysBefore, `${refused}; ${keysBefore} keys before, ${await keys()} after`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent === "Grok Bot").querySelector("input").click()`);
        await waitFor(`!${primary}.disabled`);
        await shot("agents-pick");
        await js(`${primary}.click()`);
        // XC-068: Grok Bot signs in first: the plain address, with no key in it, and a wait here for it to ask.
        const instead = () => js(`[...document.querySelectorAll("dialog.sheet[open] button.inline")].find((b) => b.textContent === "Can't sign in? Use a private link instead").click()`);
        check("Grok Bot signs in: the sheet gives its steps and waits for it to ask", await waitFor(`${sheet}.includes("Waiting for Grok Bot to ask to sign in…")`, 80) && JSON.stringify(await js(`[...document.querySelectorAll("dialog.sheet[open] .agent-steps li")].map((s) => s.firstChild.textContent)`)) === JSON.stringify(["Copy the message", "Paste it into Grok Bot's chat", "When Grok Bot opens a sign-in page, allow it here"]), await js(sheet));
        check("…with no key in it, said plainly", !/••••|lore_agent_|token|bearer|oauth/i.test(await js(sheet)) && (await js(sheet)).includes("No key in it. You allow it here"), await js(sheet));
        {
          const before = copied.length;
          await js(`document.querySelector("dialog.sheet[open] .agent-link").click()`);
          await until(() => copied.length > before, 1000);
          check("…whose message carries the plain address alone", copied.at(-1) === `Add this MCP server to my account: ${agentUrl}`, String(copied.at(-1)));
        }
        check("…and nothing is made for it until it asks", (await keys()) === keysBefore);
        await shot("agents-grok-sign-in");
        await instead();
        await waitFor(`${sheet}.includes("Waiting for Grok Bot's first save…")`, 80);
        check("connecting Grok Bot turns the sheet into Grok Bot's, with its mark", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "Connect Grok Bot"`, 80) && await js(`document.querySelector("dialog.sheet[open] .form-head img.logo").src.endsWith("assets/grok.svg")`), await js(sheet));
        const setup = await js(sheet);
        const stepsOf = () => js(`[...document.querySelectorAll("dialog.sheet[open] .agent-steps li")].map((s) => s.firstChild.textContent)`);
        check("…three steps: copy the message, paste it into Grok Bot's chat, and Lore shows the first save", JSON.stringify(await stepsOf()) === JSON.stringify(["Copy the message", "Paste it into Grok Bot's chat", "Lore shows when the first save arrives"]), setup);
        check("…one message to copy and nothing else: no path, no key, no instructions", await js(`document.querySelectorAll("dialog.sheet[open] .agent-link").length === 1 && document.querySelector("dialog.sheet[open] .agent-link .agent-link-word").textContent === "Copy message" && !document.querySelector("dialog.sheet[open] .copy-row, dialog.sheet[open] .agent-path")`), setup);
        check("…its key masked, and a quiet private-link line", /••••/.test(setup) && !/lore_agent_/.test(setup) && setup.includes("Private link, shown once") && !/token|mainnet|bearer|endpoint|oauth/i.test(setup), setup);
        check("…the message is the only place MCP shows", setup.replace("Add this MCP server to my account: ", "").search(/\bmcp\b/i) === -1, setup);
        check("…and it waits for Grok Bot's first save", setup.includes("Waiting for Grok Bot's first save…"), setup);
        check("…its wait shimmering", await js(`document.querySelector("dialog.sheet[open] .agent-wait .shimmer")?.textContent === "Waiting for Grok Bot's first save…"`));
        // APP-214: connected, with nothing saved and nothing kept yet, Today (rendered as it stands) stops asking to connect.
        const todayNow = `renderInbox(snapshot).map((p) => p.textContent).join(" ")`;
        check("as soon as Grok Bot is connected, before its first save, Today stops asking to connect an agent", await waitFor(`snapshot.library.counts.private === 0 && snapshot.library.sources.some((s) => s.connector === "agent") && !(${todayNow}).includes("Connect the AI you talk to most")`, 80), await js(todayNow));
        await press("Open Grok Bot");
        await until(() => launched.length, 1000);
        check("Grok Bot on this Mac: Open Grok Bot opens it, by its id", JSON.stringify(launched) === JSON.stringify(["grok"]), JSON.stringify(launched));
        const copyLink = async () => {
          const before = copied.length;
          // The bare link where there is one; Grok Bot has only its message.
          await js(`(document.querySelector("dialog.sheet[open] .agent-link:not(.agent-message)") ?? document.querySelector("dialog.sheet[open] .agent-link")).click()`);
          await until(() => copied.length > before, 1000);
          return copied.at(-1) ?? "";
        };
        const copyOf = async (label) => {
          const before = copied.length;
          await js(`[...document.querySelectorAll("dialog.sheet[open] .copy-row")].find((r) => r.querySelector(".form-label").textContent === ${JSON.stringify(label)}).querySelector("button").click()`);
          await until(() => copied.length > before, 1000);
          return copied.at(-1) ?? "";
        };
        const linked = (/** @type {string} */ lead) => new RegExp(`^${(lead + agentUrl).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/lore_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$`);
        const ask = "Add this MCP server to my account: ";
        const message = await copyLink();
        check("Copy message gives exactly the message, with the link and its key", linked(ask).test(message), message);
        // The clipboard stand-in records the copy before the renderer hears back, so wait for the link to say it.
        check("…and it says it copied", await waitFor(`document.querySelector("dialog.sheet[open] .agent-link").classList.contains("copied") && document.querySelector("dialog.sheet[open] .agent-link").textContent.includes("Copied")`, 20));
        check("…and no way to add it by hand, which Grok Bot doesn't have", !(await js(`/Copy link only|add it yourself/.test(document.querySelector("dialog.sheet[open]").textContent)`)));
        // APP-271: the link is back to Copy message (its Copied lasts a second and a half), in place of a fixed wait. One shot:
        // agents-grok-setup scanned this same sheet again, unchanged, straight after it.
        await waitFor(`!document.querySelector("dialog.sheet[open] .agent-link").classList.contains("copied")`, 12);
        await shot("agents-setup");

        // Grok saves, with the key it was given, and the sheet hears it.
        const key = message.slice(ask.length + agentUrl.length + 1);
        readingHeld = new Promise((done) => { releaseReading = () => done(undefined); });
        const stored = await (await call(key, "tools/call", { name: "store", arguments: { items: [{ title: "How I price sync placements", content: "I charge by the audience the placement reaches, not by the hours it took.", key: "sync-pricing", kind: "preference" }, { title: "Quote sync fees in the buyer's currency", content: "Buyers sign faster when the fee is already in their currency.", key: "sync-currency", kind: "preference" }] } })).json();
        const savedAt = Date.now();
        check("a save with that key reaches the store", stored.result?.isError === false, JSON.stringify(stored));
        const counted = await waitFor(`${sheet}.includes("Grok Bot saved 2 memories · See them →")`, 80);
        const timing = JSON.stringify({ notes: notes.length, readings: readings.length, badges, readAfterMs: (readTimes[0] ?? NaN) - savedAt, heardAfterMs: Date.now() - savedAt });
        check("…and the sheet counts what Grok Bot saved, one click from seeing it", counted && !(await js(sheet)).includes("first memory"), `${timing} ${await js(sheet)}`);
        check("…and its wait stops shimmering", await js(`Boolean(document.querySelector("dialog.sheet[open] .agent-wait")) && !document.querySelector("dialog.sheet[open] .agent-wait .shimmer")`));
        // APP-211: the owner is still on Connectors, so the automations notice waits, unsaid and unremembered.
        check("…while on Connectors, the automations notice waits for Today", await js(`!document.querySelector("#status .notice")`) && await js(`window.lore.snapshot().then((s) => s.setup.automations_noticed === false)`), await js(`document.querySelector("#status").textContent`));
        const evening = "Save what you know about me to Lore: who I am, what I like, how I work, and what I'm into lately. Then set up a routine that does this every evening.";
        // APP-229, APP-230: one paste that saves now and sets up its evening routine, offered from the start, above the wait.
        check("…with, above the wait, one message that saves now and sets up an evening routine in Grok Bot", await js(`document.querySelectorAll("dialog.sheet[open] .agent-next").length === 1 && Boolean(document.querySelector("dialog.sheet[open] .agent-next + .agent-wait"))`) && (await js(sheet)).includes("Then send Grok Bot this. It saves now, and every evening after:"), await js(sheet));
        const copiedBefore = copied.length;
        await js(`[...document.querySelectorAll("dialog.sheet[open] .agent-next button")].at(-1).click()`);
        await until(() => copied.length > copiedBefore, 1000);
        check("…with one quiet Copy that copies it", copied.at(-1) === evening && await js(`[...document.querySelectorAll("dialog.sheet[open] .agent-next")].every((n) => n.querySelectorAll("button").length === 1 && n.querySelector("button").classList.contains("quiet"))`), String(copied.at(-1)));
        await shot("agents-first-save");
        check("…read through once, named for Grok", readings.length === 1 && readings[0].title === "Grok Bot saved 2 things to Lore" && readings[0].label === "Grok Bot", JSON.stringify(readings));
        // APP-212: each way in lands on Inventory, filtered to Grok Bot, with what the owner hasn't seen marked New.
        const chip = `document.querySelector(".source-filter")?.textContent ?? ""`;
        const rowOf = (title) => `[...document.querySelectorAll("#content .invrow")].find((r) => r.querySelector(".say")?.textContent.startsWith(${JSON.stringify(title)}))`;
        const isNew = (title) => `Boolean(${rowOf(title)}?.querySelector(".new-mark"))`;
        const listed = `[...document.querySelectorAll("#content .invrow .say")].map((b) => b.textContent).join("|")`;
        await js(`[...document.querySelectorAll("dialog.sheet[open] button.inline")].find((b) => b.textContent === "See them →").click()`);
        check("See them closes the sheet and lands on Inventory, filtered to Grok Bot", await waitFor(`document.querySelector("#title").textContent === "Inventory" && !document.querySelector("dialog.sheet[open]") && (${chip}) === "Grok Bot×"`), await js(chip));
        check("…with both things Grok Bot saved marked New, and nothing else", await waitFor(`${isNew("How I price sync placements")} && ${isNew("Quote sync fees in the buyer's currency")}`) && (await js(`document.querySelectorAll("#content .invrow").length`)) === 2, await js(listed));
        await shot("agents-see-them-sheet");
        await js(`window.__lore.show("connectors")`);
        // APP-233: what Grok saved is announced as it comes in, while the reading of it is still held.
        await until(() => notes.length, 15_000);
        check("its saves are one Mac notification that names Grok, before any reading of them", notes.length === 1 && notes[0].words.title === "Grok Bot saved 2 things to Lore" && notes[0].words.body === "2 new memories. They stay private on this Mac.", JSON.stringify(notes.map((n) => n.words)));
        check("…and a red 2 on the dock", badges.at(-1) === 2, JSON.stringify(badges));
        const libraryIds = `window.lore.snapshot().then((s) => JSON.stringify(s.library.items.map((i) => i.id).sort((a, b) => a - b)))`;
        const heldIds = await js(libraryIds);
        releaseReading();
        // The reading only judges what Grok saved: its verdicts join the card they are on, and the count stays.
        await until(() => readingsLanded >= 1, 20_000);
        // APP-271: what the landing set off has been drawn, in place of a second, before saying nothing more came of it.
        await idle();
        check("what Lore judged of them leaves the count at a red 2, and says nothing more", readingsLanded === 1 && badges.at(-1) === 2 && notes.length === 1, JSON.stringify([badges, notes.length, readingsLanded]));
        // The duplicate this fixes: a reading of an agent's saves once wrote a memory of its own beside them.
        check("…and writes no memory beside Grok's own saves", await js(libraryIds) === heldIds, `${heldIds} → ${await js(libraryIds)}`);
        check("Grok's row says what it saved, and when", await waitFor(`/Saved 2 · last today/.test(${agentRow("Grok Bot")}?.textContent ?? "")`), await js(`${agentRow("Grok Bot")}?.textContent ?? ""`));
        check("…with Grok's mark, and the offer to connect another", await js(`${agentRow("Grok Bot")}.querySelector("img.logo").src.endsWith("assets/grok.svg") && Boolean(${agentRow("Connect another agent")})`));
        await shot("agents-connected");
        // APP-271: the look at the agents that coming back sets off has finished, and the app has gone quiet, in place of three seconds.
        const lookFrom = lookedAt.watch.started;
        app.emit("browser-window-focus");
        await lookedSince("watch", lookFrom);
        await idle();
        check("coming back to the app finds nothing more, and says nothing again", notes.length === 1 && readings.length === 1, String(notes.length));

        notes[0].handlers.click();
        check("clicking it lands on what Grok Bot saved, in Inventory", await waitFor(`document.querySelector("#title").textContent === "Inventory" && (${chip}) === "Grok Bot×"`), await js(chip));
        check("…just the two things it saved, seen already, with nothing of Lore's beside them", await waitFor(`Boolean(${rowOf("How I price sync placements")}) && Boolean(${rowOf("Quote sync fees in the buyer's currency")})`) && (await js(`document.querySelectorAll("#content .invrow").length`)) === 2 && !(await js(`Boolean(document.querySelector("#content .new-mark"))`)), `${await js(listed)} ${await js(`JSON.stringify({ since: unseen.since, seen: [...unseen.seen], before: [...unseen.before], arrivals: snapshot.library.items.map((i) => i.arrival), focused: document.hasFocus() })`)}`);
        await shot("agents-see-them-notification");
        await js(`window.__lore.show("inbox")`);
        const card = `[...document.querySelectorAll("#content .irow.memories")].find((r) => r.textContent.includes("from Grok Bot"))`;
        check("the Inbox's row for them is named for Grok, with how many look worth selling", await waitFor(`${card}?.querySelector(".say")?.textContent === "2 new memories from Grok Bot · 1 worth selling"`), await js(`document.querySelector("#content").textContent`));
        // APP-211: with an agent connected, Today now says once what Lore does on its own.
        const told = `[...document.querySelectorAll("#status .notice")].filter((n) => n.textContent.includes("Change this in Settings"))`;
        check("with Grok connected, Today says once that Lore reads and checks in on its own", await waitFor(`${told}.length === 1`) && (await js(`${told}[0].textContent`)).startsWith("Lore reads your connected apps every day at 9 AM and checks in at 6 PM when something's worth asking."), await js(`document.querySelector("#status").textContent + " " + JSON.stringify({ noticed: snapshot.setup.automations_noticed, told: [...told.keys()], notices: notices.map((n) => n.key), routines: routines.map((r) => r.kind + (r.paused ? "-paused" : "")), sources: snapshot.library.sources.filter((s) => s.enabled).length })`));
        check("…and remembers having said it", await waitFor(`window.lore.snapshot().then((s) => s.setup.automations_noticed === true)`));
        // APP-211: a refresh that still reads "not said" (as one started before the write would) never says it twice.
        uvRun(["python", "-c", "from lore.store import Store\nwith Store() as s:\n s.set_setting('automations_noticed', False)"], { cwd: join(__dirname, "../../.."), env: process.env });
        await js(`window.__lore.event({ type: "changed" })`);
        check("a refresh then reads it as unsaid, in the store and in the window", await waitFor(`window.lore.snapshot().then((s) => s.setup.automations_noticed === false)`) && await waitFor(`snapshot.setup.automations_noticed === false`));
        // APP-271: that refresh, and whatever it said, are done, in place of a second; then again after the two views.
        await idle();
        await js(`window.__lore.show("inventory")`);
        await js(`window.__lore.show("inbox")`);
        await idle();
        check("after a refresh that reads it as unsaid, Today still shows exactly one", await js(`${told}.length === 1`), String(await js(`${told}.length`)));
        await shot("agents-today");
        check("with Grok Bot connected, Today never asks to connect an agent", !(await js(`${todayText}.includes("Connect the AI you talk to most")`)) && !/Claude Code|Codex/.test(await js(todayText)), await js(todayText));
        check("…its new memories and the next step are each one row", await js(`document.querySelectorAll("#content .irow.memories").length === 1 && document.querySelectorAll("#content .irow.step").length === 1`), await js(todayText));
        await js(`[...${told}[0].querySelectorAll("button")].find((b) => b.textContent === "Settings").click()`);
        check("its Settings button opens Settings, which carries no notice", await waitFor(`document.querySelector("#title").textContent === "Settings"`) && await js(`!document.querySelector("#status .notice")`));
        await js(`window.__lore.show("inbox")`);
        await idle();
        check("…and it is not said again", await js(`${told}.length === 0`));
        await js(`window.__lore.show("memories")`);
        const saved = `[...document.querySelectorAll("#content .invrow")].find((r) => r.textContent.includes("How I price sync placements"))`;
        // APP-208: a date-only save shows the day it names, whatever the Mac's time zone.
        check("a date-only save shows the day it names", await js(`when("2026-10-17")`) === "Oct 17" && await js(`when("2026-10-17T03:00:00Z")`) === await js(`new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date("2026-10-17T03:00:00Z"))`));
        check("what Grok Bot saved is in Memories, from Grok", await waitFor(`/From Grok Bot/.test(${saved}?.querySelector(".src .routine-mark")?.title ?? "")`), await js(`${saved}?.outerHTML ?? ""`));
        await js(`${saved}.querySelector(".say").click()`);
        check("…and its page says so, beside it and in its Activity", await waitFor(`/Grok Bot/.test(document.querySelector("#content .memory-page .page-side")?.textContent ?? "") && /Saved by Grok Bot/.test(document.querySelector("#content .memory-page .timeline")?.textContent ?? "")`), await js(`document.querySelector("#content")?.textContent ?? ""`));
        await shot("agents-memory-from");
        await js(`document.querySelector("#task-back").click()`);
        // APP-213: what Lore judged worth selling is Grok's own save, Grok's in Inventory and in its preview.
        check("in Inventory, what Lore judged worth selling is Grok's own save, from Grok with its mark", await waitFor(`${saved}?.querySelector(".src .routine-mark")?.title === "From Grok Bot" && ${saved}.querySelector(".src img.logo")?.src.endsWith("assets/grok.svg")`), await js(`${saved}?.outerHTML ?? ""`));
        // Any refresh hides a preview (render() does), so the pointer comes back to the row until one stays up.
        const peekLine = `document.querySelector(".peek .provenance")?.textContent ?? ""`;
        for (let i = 0; i < 5 && !(await js(`Boolean(document.querySelector(".peek"))`)); i++) {
          await js(`${saved}.querySelector(".say").dispatchEvent(new MouseEvent("mouseenter"))`);
          await waitFor(`document.querySelector(".peek")`, 8);
        }
        check("its preview leads with where it came from, then the day", await waitFor(`/^From Grok Bot · [A-Z][a-z]{2} \\d{1,2}$/.test(${peekLine})`) && await js(`document.querySelector(".peek .provenance img.logo")?.src.endsWith("assets/grok.svg")`), await js(peekLine));
        await shot("agents-preview");
        await js(`${saved}.querySelector(".say").dispatchEvent(new MouseEvent("mouseleave"))`);

        // Manage: a new key stops the old one, and Disconnect stops the agent and keeps what it saved.
        await js(`window.__lore.show("connectors")`);
        await waitFor(agentRow("Grok Bot"));
        await js(`${agentRow("Grok Bot")}.querySelector("button:not(.inline)").click()`);
        check("Manage offers a new key and Disconnect", await waitFor(`${sheet}.includes("Get a new key") && ${sheet}.includes("Disconnect")`));
        check("…and, since Grok Bot has saved, its evening routine, below what it saved", await js(`${sheet}.includes("Send Grok Bot this, so it saves every evening on its own:") && ${sheet}.includes("Set up a routine that saves anything new you learn about me to Lore every evening.") && document.querySelector("dialog.sheet[open] .form-body").lastElementChild.previousElementSibling?.classList.contains("agent-next")`), await js(sheet));
        await shot("agents-manage");
        // A save the old key makes just before the new one, still waiting when the new link is shown.
        const late = await (await call(key, "tools/call", { name: "store", arguments: { items: [{ title: "Late sync note", content: "Saved with the old link, just before it was replaced.", key: "late-note", kind: "fact" }] } })).json();
        check("a save with the old key just before a new one is made", late.result?.isError === false, JSON.stringify(late));
        // Counted from the save itself: Lore's own look every 10 seconds may bring it in before the walk asks.
        const readBefore = readings.length;
        installedApps = [];
        await press("Get a new key");
        await waitFor(`${primary}?.textContent === "Get a new key"`);
        check("…and says the old key stops at once", /stops working at once/.test(await js(sheet)), await js(sheet));
        await js(`${primary}.click()`);
        check("a new key shows the setup again, waiting for the next save", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "A new link for Grok Bot"`, 80) && await js(`${sheet}.includes("Waiting for Grok Bot's next save…")`), await js(sheet));
        // APP-217: Grok Bot already has a Lore server, so a new link replaces it rather than adding a second.
        check("…and its steps end with the next save, not the first", JSON.stringify(await stepsOf()) === JSON.stringify(["Copy the message", "Paste it into Grok Bot's chat", "Lore shows when the next save arrives"]), JSON.stringify(await stepsOf()));
        const replace = "Replace the Lore MCP server in my account with this one: ";
        const replaced = await copyLink();
        check("…its message asks Grok Bot to replace the Lore server", linked(replace).test(replaced), replaced);
        const fresh = replaced.slice(replace.length + agentUrl.length + 1);
        check("…with a different key", fresh !== key && fresh.startsWith(key.slice(0, "lore_agent_".length + 16)), fresh);
        check("…the old one no longer works", (await call(key, "tools/list")).status === 401);
        check("…and the new one does", (await call(fresh, "tools/list")).status === 200);
        check("…and with Grok Bot not on this Mac, nothing offers to open it", !(await js(`[...document.querySelectorAll("dialog.sheet[open] button")].some((b) => b.textContent === "Open Grok Bot")`)), await js(sheet));
        // APP-271: one shot: agents-grok-new-key scanned this same sheet again, unchanged, straight after it.
        await shot("agents-new-key");
        // The old key's waiting save comes in now, and is not taken for the new link working.
        await js(`window.lore.checkAgents()`);
        await until(() => readings.length > readBefore, 20_000);
        check("the old key's late save is brought in while the new link waits", readings.length > readBefore, JSON.stringify(readings.map((r) => r.title)));
        // The sheet's own look, every 10 seconds (FIRST_SAVE_EVERY_MS), is what could take that save for the new link's.
        // APP-271: it has looked once since, a check of the store and then the list read after it, both answered, and
        // the app has gone quiet, in place of eleven seconds.
        const lookedFrom = ipc.length;
        const lookedAgain = () => ipc.slice(lookedFrom).some((channel, at) => {
          const checked = calls[lookedFrom + at].answered;
          return channel === "agents:check" && checked > 0 && ipc.slice(lookedFrom + at + 1).some((next, after) => next === "agents:list" && calls[lookedFrom + at + 1 + after].started >= checked && calls[lookedFrom + at + 1 + after].answered > 0);
        });
        await until(lookedAgain, 15_000);
        await idle();
        check("…and the sheet still waits for the new link's first save", await js(`${sheet}.includes("Waiting for Grok Bot's next save…") && !${sheet}.includes("saved with the new link")`), await js(sheet));
        // Grok saves again what it already saved, word for word: nothing changes in Lore, and it still shows the link works.
        const resaved = await (await call(fresh, "tools/call", { name: "store", arguments: { items: [{ title: "How I price sync placements", content: "I charge by the audience the placement reaches, not by the hours it took.", key: "sync-pricing", kind: "preference" }] } })).json();
        check("an unchanged save with the new link reaches the store", resaved.result?.isError === false, JSON.stringify(resaved));
        // APP-271: the owner comes back to Lore from Grok Bot, which looks now, as it does on any return.
        app.emit("browser-window-focus");
        check("…and the sheet shows the new link works", await waitFor(`${sheet}.includes("Grok Bot saved with the new link")`, 80) && !(await js(`Boolean(document.querySelector("dialog.sheet[open] .agent-next"))`)), await js(sheet));
        await press("Done");
        await waitFor(`!document.querySelector("dialog.sheet[open]")`);
        /** Grok saves one more thing, and Lore brings it in and reads it through. @param {string} title */
        const saveMore = async (title) => {
          const [told, landed] = [notes.length, readingsLanded];
          await call(fresh, "tools/call", { name: "store", arguments: { items: [{ title, content: `${title}, as I actually do it.`, kind: "preference" }] } });
          app.emit("browser-window-focus");
          // APP-233: the notification comes as the save is read in; what Lore judges of it lands after.
          await until(() => notes.length > told && readingsLanded > landed, 20_000);
          return notes.length === told + 1 && readingsLanded > landed;
        };
        const more = await saveMore("How I quote a rush job");
        check("another save lands while the owner is on Connectors", more, JSON.stringify([notes.map((n) => n.words), readingsLanded, readings.length]));
        const savedLink = `[...(${agentRow("Grok Bot")}?.querySelectorAll("button.inline") ?? [])].find((b) => b.textContent === "Saved 5")`;
        // APP-233: the notification comes as the save is read in, ahead of the store's own count, so give that its time.
        check("Grok Bot's card says Saved 5, as a link", await waitFor(savedLink, 80), await js(`${agentRow("Grok Bot")}?.textContent ?? ""`));
        await js(`${savedLink}.click()`);
        check("…which lands on what it saved, filtered to Grok Bot", await waitFor(`document.querySelector("#title").textContent === "Inventory" && (${chip}) === "Grok Bot×"`), await js(chip));
        check("…the new save marked New, the rest not", await waitFor(isNew("How I quote a rush job")) && !(await js(`${isNew("How I price sync placements")} || ${isNew("Quote sync fees in the buyer's currency")}`)), await js(listed));
        await shot("agents-see-them-card");
        // Seen means on screen: scrolled to, the rush job is kept as seen.
        const rush = await js(`window.lore.snapshot().then((s) => s.library.items.find((i) => i.title === "How I quote a rush job")?.arrival)`);
        await js(`${rowOf("How I quote a rush job")}.scrollIntoView({ block: "center" })`);
        check("…and once on screen it is kept as seen", await waitFor(`window.lore.memoriesSeen(0).then((kept) => kept.arrivals.includes(${Number(rush)}))`, 20), rush);
        await js(`window.__lore.show("inbox")`);
        check("a third save lands while the owner is on the Inbox", await saveMore("How I bill a rerun"));
        check("the Inbox's row for Grok Bot counts it, with Review to see them", await waitFor(`/new memories from Grok Bot/.test(${card}?.querySelector(".say")?.textContent ?? "") && ${card}.querySelector(".verb").textContent === "Review"`, 80), await js(`${card}?.textContent ?? ""`));
        await shot("agents-today-see-them");
        await js(`${card}.querySelector(".verb").click()`);
        check("…which lands filtered to Grok Bot", await waitFor(`document.querySelector("#title").textContent === "Inventory" && (${chip}) === "Grok Bot×"`), await js(chip));
        check("…the third save marked New, the rest not", await waitFor(isNew("How I bill a rerun")) && !(await js(isNew("How I quote a rush job"))), await js(listed));
        await shot("agents-see-them-inventory");
        // Seen means on screen: the last row is below the fold until the owner scrolls to it.
        await js(`${rowOf("How I bill a rerun")}.scrollIntoView({ block: "center" })`);
        const seenIds = await js(`window.lore.snapshot().then((s) => s.library.items.filter((i) => /rerun/i.test(i.title)).map((i) => i.arrival))`);
        const seenFile = join(process.env.LORE_DESKTOP_USER_DATA ?? "", "memories-seen.json");
        const kept = async () => (await new (require(join(src, "reading.cjs")).Seen)(seenFile).read(0)).arrivals;
        check("once on screen, they are kept as seen on disk, for the next launch", await until(async () => { const ids = await kept(); return seenIds.length === 1 && seenIds.every((id) => ids.includes(id)); }, 5000), JSON.stringify([seenIds, await kept()]));
        await js(`window.__lore.show("connectors")`);
        await js(`window.__lore.show("memories")`);
        check("…and New clears on the next visit", await waitFor(`${rowOf("How I bill a rerun")} && !document.querySelector("#content .new-mark")`), await js(listed));
        // The window closed, Grok saves once more, and its notification opens a new window on what it saved.
        window.close();
        await until(() => window.isDestroyed(), 2000);
        check("a save lands while Lore's window is closed", await saveMore("How I sign off a cut"));
        notes.at(-1)?.handlers.click();
        /** @type {import("electron").BrowserWindow | null} */
        let reopened = null;
        await until(() => (reopened = BrowserWindow.getAllWindows().find((each) => !each.isDestroyed() && !each.getParentWindow()) ?? null), 4000);
        check("clicking its notification opens a window", Boolean(reopened));
        if (reopened) {
          window = reopened;
          await new Promise((loaded) => window.webContents.isLoading() ? window.webContents.once("did-finish-load", () => loaded(undefined)) : loaded(undefined));
          window.webContents.debugger.attach();
          await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
          await motion(false);
          await js(`window.__lore.signIn()`);
        }
        check("…which lands on what Grok Bot saved, filtered, after the page has loaded", await waitFor(`document.querySelector("#title").textContent === "Inventory" && (${chip}) === "Grok Bot×"`), await js(`document.querySelector("#title").textContent + " | " + (${chip})`));
        check("…with the new save marked New", await waitFor(isNew("How I sign off a cut")) && !(await js(isNew("How I bill a rerun"))), await js(listed));
        await shot("agents-reopened-see-them");
        await js(`window.__lore.show("connectors")`);
        await waitFor(agentRow("Grok Bot"));
        await js(`${agentRow("Grok Bot")}.querySelector("button:not(.inline)").click()`);
        await waitFor(`${sheet}.includes("Disconnect")`);
        await press("Disconnect");
        await waitFor(`${sheet}.includes("Disconnect Grok Bot?")`);
        check("Disconnect offers to keep or delete what Grok Bot saved", /The 6 memories it saved stay in your library/.test(await js(sheet)) && await js(`[...document.querySelectorAll("dialog.sheet[open] button")].some((b) => b.textContent === "Delete them too")`), await js(sheet));
        await shot("agents-disconnect");
        await press("Disconnect");
        check("disconnecting keeps its memory and says so", await waitFor(`document.querySelector("#status").textContent.includes("Disconnected Grok Bot. 6 memories kept.")`, 80), await js(`document.querySelector("#status").textContent`));
        await js(`window.__lore.show("memories")`);
        check("…and what it saved still says Grok Bot, with its mark", await waitFor(`${saved}?.querySelector(".src .routine-mark")?.title === "From Grok Bot" && ${saved}.querySelector(".src img.logo")?.src.endsWith("assets/grok.svg")`), await js(`${saved}?.outerHTML ?? ""`));
        await js(`window.__lore.show("connectors")`);
        check("…takes Grok off Connectors", await waitFor(`!${agentRow("Grok Bot")} && Boolean(${agentRow("Connect an agent")})`));
        check("…and its key stops working", (await call(fresh, "tools/list")).status === 401);
        await shot("agents-disconnected");

        // APP-217: Claude and ChatGPT take the same private link, each by the steps its maker documents; Other keeps the
        // link and the address and key for apps that ask for both.
        /** @param {string} label @param {string} name */
        const connectNew = async (label, name) => {
          await js(`(${agentRow("Connect an agent")} ?? ${agentRow("Connect another agent")}).querySelector("button").click()`);
          await waitFor(`${sheet}.includes("Which agent should save to Lore?")`);
          await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent === ${JSON.stringify(label)}).querySelector("input").click()`);
          await js(`${primary}.click()`);
          // A private link, for the agents that would sign in first (XC-068). APP-271: the sheet has settled on one or the
          // other, in place of two seconds spent waiting for a sign-in that, for these agents, never comes.
          const signsIn = `${sheet}.includes(${JSON.stringify(`Waiting for ${name} to ask to sign in…`)})`;
          await waitFor(`${signsIn} || ${sheet}.includes(${JSON.stringify(`Waiting for ${name}'s first save…`)})`, 80);
          if (await js(signsIn)) await instead();
          return waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === ${JSON.stringify(`Connect ${name}`)} && ${sheet}.includes(${JSON.stringify(`Waiting for ${name}'s first save…`)})`, 80);
        };
        const plainly = (/** @type {string} */ text) => !/\bmcp\b|oauth|token|bearer|endpoint|header|offer yet/i.test(text);
        /** @param {string} name @param {string[]} steps @param {string} note @param {RegExp} [allowed] a label the app itself uses */
        const linkSheet = async (name, steps, note, allowed, ask) => {
          check(`${name} gets its own sheet, waiting for its first save`, await connectNew(name, name), await js(sheet));
          const text = await js(sheet);
          check(`…with the steps ${name}'s maker documents`, JSON.stringify(await stepsOf()) === JSON.stringify(steps), JSON.stringify(await stepsOf()));
          check("…a quiet note about its plan", await js(`[...document.querySelectorAll("dialog.sheet[open] .form-body p.hint")].some((p) => p.textContent === ${JSON.stringify(note)})`), text);
          // APP-230: an agent that can add Lore itself is also offered the message to send it, as a second, masked link.
          check("…one private link, or with the message to send instead, and nothing else to paste: no address, key, instructions or sign-in notice", await js(`document.querySelectorAll("dialog.sheet[open] .agent-link").length === ${ask ? 2 : 1} && document.querySelectorAll("dialog.sheet[open] .agent-message").length === ${ask ? 1 : 0} && !document.querySelector("dialog.sheet[open] .copy-row") && ![...document.querySelectorAll("dialog.sheet[open] button")].some((b) => /^(Copy all|Open)/.test(b.textContent))`) && plainly((allowed ? text.replace(allowed, "") : text).replace(ask ?? "", "")), text);
          if (ask) check("…leading with the message, the steps folded under Or add it by hand", await js(`document.querySelector("dialog.sheet[open] .form-body .agent-message")?.compareDocumentPosition(document.querySelector("dialog.sheet[open] details.agent-by-hand .agent-steps")) === Node.DOCUMENT_POSITION_FOLLOWING && !document.querySelector("dialog.sheet[open] details.agent-by-hand").open`), await js(sheet));
          if (ask) check("…the message saying how to add Lore, with its key masked", (await js(`document.querySelector("dialog.sheet[open] .agent-message")?.textContent ?? ""`)).includes(ask) && (await js(`document.querySelector("dialog.sheet[open] .agent-message")?.textContent ?? ""`)).includes("••••"), await js(sheet));
          const link = await copyLink();
          check("…and Copy gives the bare link with its key", linked("").test(link), link);
          const byHand = await js(`{ const data = new DataTransfer(); document.querySelector("dialog.sheet[open] .agent-link:not(.agent-message) .agent-link-url").dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true })); data.getData("text/plain"); }`);
          check("…and copying the shown link by hand takes the real one, not its dots", byHand === link, byHand);
        };
        // Claude's and ChatGPT's apps on this Mac too: only Grok Bot's sheet offers to open its app.
        installedApps = ["grok", "claude", "chatgpt"];
        await linkSheet("Claude", ["In Claude, open Customize › Connectors, then + Add › Add custom connector", "Name it Lore, paste the link below, and choose Continue", "Choose No sign in, then Add"], "Claude's free plan allows one custom connector.");
        await shot("agents-claude-setup");
        await press("Done");
        check("…and it joins the agents with Claude's mark", await waitFor(`${agentRow("Claude")}?.querySelector("img.logo")?.src.endsWith("assets/claude.svg") && /Nothing saved yet/.test(${agentRow("Claude")}.textContent)`), await js(`${agentRow("Claude")}?.textContent ?? ""`));
        // A new link for Claude replaces the Lore connector it has, which on the free plan is its only one.
        await js(`${agentRow("Claude")}.querySelector("button").click()`);
        await waitFor(`${sheet}.includes("Get a new key")`);
        await press("Get a new key");
        await waitFor(`${primary}?.textContent === "Get a new key"`);
        await js(`${primary}.click()`);
        check("a new link for Claude says to replace the Lore connector, not add another", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "A new link for Claude"`, 80) && JSON.stringify(await stepsOf()) === JSON.stringify(["In Claude, open Customize › Connectors", "Open the Lore connector you added before and replace its link with this one"]), JSON.stringify(await stepsOf()));
        check("…with removing it and adding a new one as a quiet line under that step, not a step of its own", await js(`document.querySelector("dialog.sheet[open] .agent-steps li:last-child .agent-step-or")?.textContent === "Or remove it and add a new one named Lore with this link"`), await js(sheet));
        check("…waits for its next save", (await js(sheet)).includes("Waiting for Claude's next save…"), await js(sheet));
        check("…and copies the bare new link", linked("").test(await copyLink()));
        await shot("agents-claude-new-key");
        await press("Done");
        // XC-068: ChatGPT signs in. The store's sign-in page asks; Lore shows the Allow card with the page's code.
        const askSignIn = (/** @type {string} */ client) => JSON.parse(uvRun(["python", "-m", "tests.fixtures.inbox", "ask", "--client", client], { cwd: process.env.LORE_EDGE_REPO, env: process.env }).toString());
        const signInRow = (/** @type {string} */ id) => JSON.parse(uvRun(["python", "-c", `import json, sqlite3, os\nrow = sqlite3.connect(os.environ["LORE_EDGE_D1"]).execute("SELECT state, agent FROM sign_ins WHERE id = ?", (${JSON.stringify(id)},)).fetchone()\nprint(json.dumps(row))`], { cwd: process.env.LORE_EDGE_REPO, env: process.env }).toString());
        await js(`${agentRow("Connect another agent")}.querySelector("button").click()`);
        await waitFor(`${sheet}.includes("Which agent should save to Lore?")`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent === "ChatGPT").querySelector("input").click()`);
        await js(`${primary}.click()`);
        check("ChatGPT gets its sign-in sheet, waiting for it to ask", await waitFor(`${sheet}.includes("Waiting for ChatGPT to ask to sign in…")`, 80), await js(sheet));
        check("…with the steps ChatGPT documents for signing in", JSON.stringify(await stepsOf()) === JSON.stringify(["In ChatGPT, open Plugins, then + › Add custom MCP server", "Name it Lore, paste the address below, choose OAuth, and continue", "Choose Create, then allow it here"]), JSON.stringify(await stepsOf()));
        check("…a quiet note about its plan", await js(`[...document.querySelectorAll("dialog.sheet[open] .form-body p.hint")].some((p) => p.textContent === "Saving to Lore needs a ChatGPT plan that allows custom connectors to write.")`));
        const address = await copyLink();
        check("…and Copy gives the plain address, with no key", address === agentUrl, address);
        await shot("agents-chatgpt-setup");
        const asking = askSignIn("ChatGPT");
        await js(`window.lore.checkAgents()`);
        check("when ChatGPT asks to sign in, the sheet becomes the Allow card, with the code its page shows", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "ChatGPT wants to save to your Lore" && document.querySelector("dialog.sheet[open] .sign-in-code")?.textContent === ${JSON.stringify(asking.code)}`, 80), await js(sheet));
        const allowCard = await js(sheet);
        check("…saying plainly to match the code, with Allow and Deny", allowCard.includes("Allow it only if your browser shows this code.") && plainly(allowCard) && (await js(`${primary}.textContent`)) === "Allow" && await js(`[...document.querySelectorAll("dialog.sheet[open] button")].some((b) => b.textContent === "Deny")`), allowCard);
        await shot("agents-allow-card");
        await js(`${primary}.click()`);
        check("Allow connects ChatGPT, and the sheet waits for its first save", await waitFor(`${sheet}.includes("ChatGPT is connected") && ${sheet}.includes("Waiting for ChatGPT's first save…")`, 80), await js(sheet));
        const bound = signInRow(asking.id);
        const chatgpt = (await js(`window.lore.agents()`)).find((/** @type {AgentEntry} */ a) => a.app === "chatgpt");
        check("…and the store's sign-in is bound to the new agent, which signed in", bound?.[0] === "allowed" && bound?.[1] === chatgpt?.source.replace("agent-", "") && chatgpt?.signed_in === true, JSON.stringify({ bound, chatgpt }));
        await shot("agents-allowed");
        await press("Done");
        check("…and it joins the agents with ChatGPT's mark", await waitFor(`${agentRow("ChatGPT")}?.querySelector("img.logo")?.src.endsWith("assets/chatgpt.svg")`), await js(`${agentRow("ChatGPT")}?.textContent ?? ""`));
        await js(`${agentRow("ChatGPT")}.querySelector("button").click()`);
        check("Manage for a signed-in agent offers only Disconnect: it has no link to replace", await waitFor(`${sheet}.includes("ChatGPT signed in, so it has no link to replace.")`) && !(await js(sheet)).includes("Get a new key") && await js(`[...document.querySelectorAll("dialog.sheet[open] button")].some((b) => b.textContent === "Disconnect")`), await js(sheet));
        await shot("agents-signed-in-manage");
        await js(`closeSheet()`);
        // An app that asks while no sheet waits for it gets the card on its own; Deny binds nothing.
        const agentsBefore = (await js(`window.lore.agents()`)).length;
        const stranger = askSignIn("Claude");
        await js(`window.lore.checkAgents()`);
        check("an app asking with no sheet open brings up the Allow card on its own", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "Claude wants to save to your Lore" && document.querySelector("dialog.sheet[open] .sign-in-code")?.textContent === ${JSON.stringify(stranger.code)}`, 80), await js(sheet));
        await press("Deny");
        check("…Deny closes it and says so, and binds nothing", await waitFor(`!document.querySelector("dialog.sheet[open]") && document.querySelector("#status").textContent.includes("Denied. Claude can't save to Lore.")`) && signInRow(stranger.id)?.[0] === "denied" && (await js(`window.lore.agents()`)).length === agentsBefore, await js(`document.querySelector("#status").textContent`));
        // APP-271: that look has been answered (the call waits for it) and what it set off drawn, in place of a second.
        await js(`window.lore.checkAgents()`);
        await idle();
        check("…and it is not asked about again", !(await js(`Boolean(document.querySelector("dialog.sheet[open]"))`)));
        check("Other keeps a link, and the address and key for apps that ask for both", await connectNew("Other", "My agent") && await js(`document.querySelectorAll("dialog.sheet[open] .agent-link").length === 1 && JSON.stringify([...document.querySelectorAll("dialog.sheet[open] .copy-row .form-label")].map((l) => l.textContent)) === '["Address","Key","Instructions"]'`), await js(sheet));
        check("…with no sign-in notice", !/offer yet/.test(await js(sheet)), await js(sheet));
        check("…and its instructions name it", (await copyOf("Instructions")).includes("You are My agent"));
        await shot("agents-other-setup");
        await press("Done");

        // #597: Instinct is texted a setup message holding only the plain address; its key goes, apart, to Instinct's secure form.
        check("Instinct gets its own text-first sheet, waiting for its first save", await connectNew("Instinct", "Instinct"), await js(sheet));
        const textFirst = await js(sheet);
        check("…three steps: text it the setup message, its key into Instinct's secure form, approve one memory", JSON.stringify(await stepsOf()) === JSON.stringify(["Copy the setup message and text it to Instinct, in the conversation you already have", "When Instinct asks for your Lore key, copy it below into the secure form Instinct gives you. Never text the key", "Instinct shows you one memory it would save. Approve it, and Lore shows here when it arrives"]), JSON.stringify(await stepsOf()));
        check("…no address, key or instructions rows, no Copy all, and nothing asking it to save everything or every evening", await js(`!document.querySelector("dialog.sheet[open] .copy-row, dialog.sheet[open] .agent-next") && ![...document.querySelectorAll("dialog.sheet[open] button")].some((b) => /^Copy all/.test(b.textContent))`) && textFirst.includes("Key shown once") && textFirst.includes("Connecting Instinct is new. If Instinct can't finish it, connect it as Other instead.") && await js(`[...document.querySelectorAll("dialog.sheet[open] button.inline")].some((b) => b.textContent === "connect it as Other instead")`), textFirst);
        const copyFrom = async (/** @type {string} */ selector) => {
          const before = copied.length;
          await js(`document.querySelector("dialog.sheet[open] ${selector}").click()`);
          await until(() => copied.length > before, 1000);
          return copied.at(-1) ?? "";
        };
        const setupMessage = await copyFrom(".agent-message");
        check("…Copy message gives the setup message, with the plain address and no key", setupMessage === `Help me connect my Lore. Show me one memory you'd save, and ask me before saving anything. My Lore's address: ${agentUrl}` && !/lore_agent_/.test(setupMessage), setupMessage);
        const instinctKey = await copyFrom(".agent-secure-key .agent-link");
        check("…and Copy key gives the key alone, for the secure form, masked on screen", /^lore_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/.test(instinctKey) && !textFirst.includes(instinctKey) && /••••/.test(textFirst), instinctKey);
        await shot("agents-instinct-setup");
        // The owner approves one memory in Instinct, and Instinct saves it with the key from the secure form.
        const one = await (await call(instinctKey, "tools/call", { name: "store", arguments: { items: [{ title: "I take calls before noon", content: "I keep afternoons for deep work, so I book calls before noon.", key: "calls-before-noon", kind: "preference" }] } })).json();
        check("Instinct's one approved save reaches the store", one.result?.isError === false, JSON.stringify(one));
        // APP-271: the owner comes back to Lore from Instinct, which looks now, as it does on any return, rather than
        // on the sheet's next ten-second look.
        app.emit("browser-window-focus");
        check("…and the sheet says it's on this Mac, one click from it", await waitFor(`${sheet}.includes("1 memory from Instinct on this Mac · See it →")`, 120), await js(sheet));
        await shot("agents-instinct-saved");
        await press("Done");
        check("…and it joins the agents with Instinct's mark", await waitFor(`/Saved 1/.test(${agentRow("Instinct")}?.textContent ?? "") && ${agentRow("Instinct")}.querySelector("img.logo").src.endsWith("assets/instinct.svg")`, 80), await js(`${agentRow("Instinct")}?.textContent ?? ""`));
        await js(`[...${agentRow("Instinct")}.querySelectorAll("button")].find((b) => b.textContent === "Manage").click()`);
        check("Manage for Instinct offers, once it has saved, the ask to keep saving, asking before each save", await waitFor(`${sheet}.includes("When you want Instinct to keep saving, text it this. It asks you before each save:") && ${sheet}.includes("From now on, when you learn something about me worth keeping, show it to me and save it to Lore once I say yes.")`), await js(sheet));
        await press("Get a new key");
        check("…a new key is copied into Instinct's secure form, never texted", await waitFor(`${sheet}.includes("You copy the new one into Instinct's secure form, never into a text.")`), await js(sheet));
        await js(`${primary}.click()`);
        check("…and the new key's sheet has no setup message, only the key and its steps", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "A new link for Instinct"`, 80) && JSON.stringify(await stepsOf()) === JSON.stringify(["Copy the new key below into the secure form Instinct gives you for Lore, in place of the old one. Never text the key", "Lore shows here when Instinct's next save arrives"]) && await js(`!document.querySelector("dialog.sheet[open] .agent-message") && Boolean(document.querySelector("dialog.sheet[open] .agent-secure-key"))`), await js(sheet));
        const newKey = await copyFrom(".agent-secure-key .agent-link");
        check("…a different key, and the old one stops working", newKey !== instinctKey && /^lore_agent_/.test(newKey) && (await call(instinctKey, "tools/call", { name: "store", arguments: { items: [{ title: "x", content: "y", key: "x", kind: "preference" }] } })).status === 401, newKey);
        await press("Done");

        // Claude Code's own memory on this Mac connects from its tile, and turns off from it again.
        const histories = `[...document.querySelectorAll("#content section")].find((s) => s.querySelector("h2")?.textContent === "Your apps")`;
        const claudeCode = `[...(${histories}?.querySelectorAll(".row") ?? [])].find((r) => r.querySelector("b").textContent === "Claude Code")`;
        check("Claude Code is offered, with a way to connect it", await waitFor(`${claudeCode}?.querySelector("button")?.textContent === "Connect"`), await js(`${claudeCode}?.textContent ?? ""`));
        await js(`${claudeCode}.click()`);
        check("…a click on its tile says what Lore will read, plainly", await waitFor(`${sheet}.includes("Lore reads the memory notes Claude Code keeps for each of your projects on this Mac")`), await js(sheet));
        await shot("agents-history-connect");
        await js(`${primary}.click()`);
        check("…and Connect turns it on and brings in what it remembers", await waitFor(`/Connected/.test(${claudeCode}?.textContent ?? "") && /1 memory imported/.test(${claudeCode}.textContent)`, 120), await js(`${claudeCode}?.textContent ?? ""`));
        await js(`window.__lore.event({ type: "show", view: "inventory", source: { id: ${JSON.stringify(readings[0].by.id)}, label: "Grok Bot" } })`);
        check("filtered to Grok Bot, Inventory shows only what it brought in", await waitFor(`(${chip}) === "Grok Bot×" && !${rowOf("Ship the smallest change that proves it")} && Boolean(${rowOf("How I bill a rerun")})`), await js(listed));
        await shot("agents-filter-chip");
        await js(`document.querySelector(".source-filter .dismiss").click()`);
        check("…and removing the chip shows everything again", await waitFor(`!document.querySelector(".source-filter") && Boolean(${rowOf("Ship the smallest change that proves it")}) && Boolean(${rowOf("How I bill a rerun")})`), await js(listed));
        await js(`window.__lore.show("connectors")`);
        await waitFor(claudeCode);
        await js(`${claudeCode}.click()`);
        await waitFor(`${primary}?.textContent === "Turn off"`);
        await js(`${primary}.click()`);
        check("…Turn off keeps what it brought in and says so", await waitFor(`document.querySelector("#status").textContent.includes("Turned off Claude Code. What it brought in stays.") && ${claudeCode}?.querySelector("button")?.textContent === "Connect"`, 80), await js(`document.querySelector("#status").textContent`));

        // XC-069: the store went online only for the agents. Nothing in the app says anything is for sale, and
        // opening it for sale is still the first approved piece's own step, with a price and where payments go.
        check("putting the store online for the agents (XC-088) ran no deploy thread, so asked nothing of a price or payout", !prompts.some((p) => p.task === "deploy") && storeOnlineCalls.length === 1, `${JSON.stringify(prompts)}; ${JSON.stringify(storeOnlineCalls)}`);
        check("the store is online for agents, not open for sale", await js(`window.lore.snapshot().then((s) => Boolean(s.node.url) && s.node.selling === false)`));
        await js(`window.__lore.show("settings")`);
        const bar = `([...document.querySelectorAll("#content .row")].find((r) => r.querySelector(".t b")?.textContent === "Address")?.textContent ?? "")`;
        check("Settings says the store is online, not live, and offers to open it for sale", await waitFor(`/Online/.test(${bar}) && /Open your store/.test(${bar}) && !/\\bLive\\b|Payouts/.test(${bar})`), await js(bar));
        await shot("agents-nothing-for-sale");
        check("…and Settings offers no marketplace listing for it", await waitFor(`document.querySelector("#content")?.textContent.includes("Address")`) && !(await js(`[...document.querySelectorAll("#content .row b")].some((b) => b.textContent === "Marketplace")`)));
        await js(`window.__lore.show("inbox")`);
        check("…and Today offers no store update", await waitFor(todayShown) && !(await js(`/Update store|live yet/.test(document.querySelector("#content").textContent)`)), await js(`document.querySelector("#content").textContent`));
        // The first approved piece: opening the store for sale asks for a price and where payments go, as always.
        uvRun(["python", "-c", "from lore.store import Store\nwith Store() as s:\n judged = s.db.execute(\"SELECT id FROM memories WHERE title = 'How I price sync placements'\").fetchone()[0]\n s.add_publication(title='How I price sync placements', content='Charge by the audience.', topic='licensing', teaser='How to price a sync placement', provenance=[judged])"], { cwd: process.env.LORE_EDGE_REPO, env: process.env });
        await js(`window.__lore.event({ type: "changed" })`);
        const rung = `document.querySelector("#content .irow.step")`;
        check("the first approved piece offers to open the store", await waitFor(`/isn't on sale yet/.test(${rung}?.textContent ?? "") && ${rung}.querySelector(".verb").textContent === "Open your store"`, 80), await js(`document.querySelector("#content").textContent`));
        await js(`window.__lore.show("inventory")`);
        const shelves = await js(`[...document.querySelectorAll(".ptab")].map((s) => s.textContent).join("|")`);
        check("…and Inventory calls it ready to sell, not on sale", /Ready to sell1/.test(shelves) && !/On sale/.test(shelves), shelves);
        await js(`window.__lore.show("inbox")`);
        // APP-271: its Open your store is drawn. This waited ten seconds every run for "Pick a price and where payments
        // go", which the row no longer says, and went on when the wait ran out.
        await waitFor(`${rung}?.querySelector(".verb")?.textContent === "Open your store"`);
        const before = prompts.length;
        await js(`${rung}.querySelector("button").click()`);
        await until(() => prompts.length > before, 4000);
        check("…through the store's usual opening, not the agents' one", prompts.at(-1)?.task === "deploy" && prompts.at(-1)?.text.includes("Help me open my store.") && !/personal agents/.test(prompts.at(-1)?.text ?? ""), JSON.stringify(prompts.slice(before)));
        await js(`document.querySelector("#task-back")?.click()`);
        await waitFor(`!detailTask`);
        await js(`window.__lore.show("store")`);
        const shelf =`(document.querySelector(".ptab[aria-selected=true]")?.textContent ?? "")`;
        check("Inventory files it under Ready to sell, waiting for the store to open", await waitFor(`${shelf}.startsWith("Ready to sell") && [...document.querySelectorAll("#content .invrow .st")].some((st) => st.textContent === "Ready to sell") && !document.querySelector("#content").textContent.includes("On sale")`), await js(`document.querySelector("#content").textContent`));
        await shot("agents-ready-to-sell");
      } else if (scenario === "routines") {
        // APP-270: Lore's own rhythm, in the order an owner meets it: the reading missed while Lore was closed (the
        // schedule walk's), an app connected and read through (the reading walk's), then every automation in one list
        // (the automations walk's). One stand-in model reads all three; each count below is taken from where it stood.
        const repo = join(__dirname, "../../..");
        const python = (/** @type {string} */ code) => uvRun(["python", "-c", `from datetime import datetime, timedelta, timezone\nfrom lore import automation\nnow = datetime.now(timezone.utc)\n${code}`], { cwd: repo, env: process.env, encoding: "utf8" });
        const listed = () => JSON.parse(uvRun(["lore", "automation", "list", "--json"], { cwd: repo, env: process.env, encoding: "utf8" }));
        const clock = (/** @type {number} */ hour) => `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`;
        // AUT-006: Lore was closed at its reading hour, so opening it reads once, unasked, and says so as a connect does.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await until(() => readings.length, 15_000);
        check("the launch catches up on the missed hour with one reading", readings.length === 1 && readings[0].label === "Obsidian" && readings[0].added === 1, JSON.stringify(readings));
        await until(() => notes.length, 15_000);
        check("…which lands as the same Mac notification", notes.length === 1 && notes[0].words.title === "Lore read your Obsidian notes" && notes[0].words.body === "2 new memories. 1 looks worth selling.", JSON.stringify(notes.map((n) => n.words)));
        check("…and the same red number on the dock", badges.at(-1) === 2, JSON.stringify(badges));
        await js(`window.__lore.show("inbox")`);
        check("…and the same New memories card on Today", await waitFor(`document.querySelector("#content").textContent.includes("Lore read your Obsidian notes")`));
        await shot("schedule-today-ready");
        const routines = listed();
        const synthesis = routines.find((routine) => routine.id === "synthesis");
        check("the CLI remembers the run and its result, so it is not owed again", synthesis?.due === false && synthesis.result === "1 new note" && synthesis.last_run, JSON.stringify(routines));
        await js(`window.__lore.event({ type: "changed" })`);
        await js(`window.__lore.show("automations")`);
        const rhythm = `[...document.querySelectorAll("#automations .row")].find((r) => r.querySelector("b")?.textContent === "Read connected apps")?.textContent ?? ""`;
        const hour = Number(synthesis?.hour);
        check("Settings says when Lore reads next, under Automations", await waitFor(`(${rhythm}).includes("Every day at ${clock(hour)} · Next run")`), await js(rhythm));
        check("…in plain words", !/cron|executor|schedul(e|ing) task/i.test(await js(rhythm)), await js(rhythm));
        await js(`document.querySelector("#automations").scrollIntoView()`);
        await shot("schedule-connectors");
        // Seen and done, so the next reading's row is the Inbox's only one and the dock starts again from nothing.
        await js(`window.__lore.show("inbox")`);
        const caughtUp = `[...document.querySelectorAll("#content .irow.memories")].find((r) => r.textContent.includes("Lore read your Obsidian notes"))`;
        await waitFor(caughtUp);
        await js(`${caughtUp}.querySelector(".done").click()`);
        check("Done takes the caught-up reading's row out of the Inbox, and the dock clears", await waitFor(`!${caughtUp}`) && await until(() => badges.at(-1) === 0, 4000), JSON.stringify(badges));
        // AUT-005: connect Granola, and Lore reads the meetings through without being asked.
        const readBefore = readings.length;
        const toldBefore = notes.length;
        await js(`window.__lore.show("connectors")`);
        const granola = `[...[...document.querySelectorAll("#content section")].find((s) => s.querySelector("h2")?.textContent === "Your apps").querySelectorAll(".row")].find((r) => r.querySelector("b").textContent === "Granola")`;
        await waitFor(granola);
        await js(`${granola}.querySelector("button").click()`);
        await waitFor(`document.querySelector("dialog.sheet[open] .btn.primary")?.textContent === "Sign in to Granola"`);
        // APP-271: the walk holds this reading open while it looks at it working, then lets it land.
        readingHeld = new Promise((done) => { releaseReading = () => done(undefined); });
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        check("connecting says Lore is turning the meetings into memories", await waitFor(`document.querySelector("#status").textContent.includes("Lore is turning them into memories now.")`), await js(`document.querySelector("#status").textContent`));
        await until(() => readings.length > readBefore, 10_000);
        check("…and starts one reading of what came in", readings.length === readBefore + 1 && readings.at(-1)?.label === "Granola" && readings.at(-1)?.item === "meeting" && readings.at(-1)?.added === 2, JSON.stringify(readings.slice(readBefore)));
        await js(`window.__lore.show("inbox")`);
        check("Today shows the reading as one quiet row", await waitFor(`document.querySelector("#content").textContent.includes("Reading your Granola meetings…")`));
        check("…and the owner can still type", await js(`!document.querySelector("#capture-input").disabled`));
        const readingLabel = `document.querySelector("#content .irow.reading .say")`;
        check("…its words shimmering while it reads", await js(`${readingLabel}?.textContent === "Reading your Granola meetings…" && ${readingLabel}.classList.contains("shimmer") && ${animating(readingLabel, "shimmer")}`));
        await shot("reading-today-working");
        await motion(true);
        check("…and standing still, plain to read, under reduced motion", await js(`getComputedStyle(${readingLabel}).animationName === "none" && getComputedStyle(${readingLabel}).color !== "rgba(0, 0, 0, 0)"`));
        await motion(false);
        await js(`window.__lore.show("connectors")`);
        releaseReading();
        await until(() => notes.length > toldBefore, 15_000);
        check("a finished reading is one Mac notification", notes.length === toldBefore + 1 && notes[toldBefore].words.title === "Lore read your Granola meetings" && notes[toldBefore].words.body === "2 new memories. 1 looks worth selling.", JSON.stringify(notes.slice(toldBefore).map((n) => n.words)));
        check("…and a red 2 on the dock while the owner is elsewhere", badges.at(-1) === 2, JSON.stringify(badges));
        check("…and the notice that it was reading goes away", await waitFor(`!document.querySelector("#status").textContent.includes("Lore is turning them into memories now.")`), await js(`document.querySelector("#status").textContent`));
        notes[toldBefore].handlers.click();
        const card = `document.querySelector("#content .irow.memories")`;
        check("clicking it lands on the Inbox's row for them", await waitFor(`${card}?.querySelector(".say")?.textContent === "Lore read your Granola meetings · 2 new memories · 1 worth selling"`), await js(`document.querySelector("#title").textContent + " | " + document.querySelector("#content").textContent.slice(0, 200)`));
        check("…in plain words", !/synthes|agent|pipeline|mcp/i.test(await js(`${card}.textContent`)), await js(`${card}.textContent`));
        check("seeing it clears the dock", await until(() => badges.at(-1) === 0, 4000), JSON.stringify(badges));
        check("…and nothing in the Inbox shimmers once it has read", await js(`!document.querySelector("#content .shimmer")`));
        await shot("reading-today-ready");
        await js(`window.__lore.show("memories")`);
        check("the memories are in Inventory, in one list with no source groups (APP-289)", await waitFor(`document.querySelector("#content").textContent.includes("Raise the first price only after ten buyers pay")`) && await js(`[...document.querySelectorAll("#content .invrow")].some((r) => r.textContent.includes("ops management"))`) && await js(`![...document.querySelectorAll("#content .igroup .label")].some((l) => l.textContent === "work" || l.textContent === "personal")`));
        const older = `[...document.querySelectorAll("#content .invrow")].find((r) => r.textContent.includes("An older lesson Lore wrote"))`;
        check("one Lore wrote before it kept who from says so, never a guess", await js(`${older}?.querySelector(".src .routine-mark")?.title === "Written by Lore" && Boolean(${older}.querySelector(".src .routine-mark svg rect"))`), await js(`${older}?.outerHTML ?? ""`));
        // Who wrote them is recorded last, after the banner, so Inventory names them once that lands.
        check("…while the new ones say Granola, with Granola's own mark", await waitFor(`(() => { const mark = [...document.querySelectorAll("#content .invrow")].find((r) => r.textContent.includes("Raise the first price"))?.querySelector(".src .routine-mark"); return mark?.title === "From Granola" && mark.querySelector("img.logo")?.src.endsWith("assets/granola.svg"); })()`));
        check("each group is a flat header row: a chevron, its name and its count, no letter avatar", await js(`[...document.querySelectorAll("#content .igroup")].every((g) => g.querySelector(".chev") && g.querySelector(".label") && g.querySelector(".n") && !g.querySelector(".initial, img"))`));
        check("a mark Lore doesn't ship is never drawn from a path", await js(`sourceMark({ kind: "app", id: "x", label: "X", mark: "../../elsewhere", at: null }) === STEP_ICONS.connect && sourceMark({ kind: "app", id: "x", label: "X", mark: "constructor", at: null }) === STEP_ICONS.connect`));
        await js(`${older}.scrollIntoView({ block: "center" })`);
        await shot("reading-inventory-from");
        await js(`window.__lore.show("inbox")`);
        await waitFor(card);
        await js(`${card}.querySelector(".verb").click()`);
        check("Review opens them in Inventory", await waitFor(`document.querySelector("#title").textContent === "Inventory" && document.querySelector("#content").textContent.includes("Raise the first price only after ten buyers pay")`));
        await js(`window.__lore.show("inbox")`);
        await waitFor(card);
        await js(`${card}.querySelector(".done").click()`);
        check("Done takes the row out of the Inbox", await waitFor(`!${card}`));
        check("…and a relaunch would not bring it back", await waitFor(`window.lore.readyRuns().then((runs) => runs.length === 0)`));
        // APP-200: every routine in one list, Lore's own first; pause, retime, run now, add and remove, all kept by the CLI.
        // The seed paused Lore's other routines so only the reading was owed at launch; they are turned back on here, as
        // an owner who never paused them would have them. Turned on, none runs at once.
        python("routines = automation.Routines()\nfor routine in ('checkin', 'collect'):\n    routines.change(routine, paused=False)");
        await js(`window.__lore.event({ type: "changed" })`);
        const mine = () => listed().find((/** @type {Routine} */ routine) => !routine.built_in);
        const readingHour = Number(listed().find((/** @type {Routine} */ routine) => routine.id === "synthesis")?.hour);
        await js(`window.__lore.show("automations")`);
        const rowOf = (/** @type {string} */ name) => `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector("b")?.textContent === ${JSON.stringify(name)})`;
        const SUNDAY = "Every Sunday, remember what I read this week";
        // The page reads the routines again on that "changed"; until it has, it still draws the two as paused.
        const on = (/** @type {string} */ name) => `${rowOf(name)}?.querySelector(".switch")?.getAttribute("aria-checked") === "true" && Boolean(${rowOf(name)}.querySelector("[data-next]")?.dataset.next)`;
        check("Lore's own routines, turned back on, show on with their next run", await waitFor(`${on("Evening check-in")} && ${on("Suggest collections")}`), await js(`[...document.querySelectorAll("#automations .row")].map((r) => r.textContent).join(" | ")`));
        check("Settings lists Lore's own automations first, then the owner's", await waitFor(`${rowOf(SUNDAY)}`) && await js(`document.querySelector("#title").textContent === "Settings" && [...document.querySelectorAll("#automations .row .t b")].map((b) => b.textContent).join("|")`) === `Read connected apps|Evening check-in|Suggest collections|${SUNDAY}`, await js(`[...document.querySelectorAll("#automations .row .t b")].map((b) => b.textContent).join("|")`));
        const text = await js(`document.querySelector("#automations").textContent`);
        const nexts = await js(`[...document.querySelectorAll("#content .row.routine")].map((r) => r.querySelector("[data-next]")?.dataset.next ?? "")`);
        check("…each with when it runs and when it runs next", text.includes(`Every day at ${clock(readingHour)}`) && text.includes("Every weekday at 6 PM") && text.includes("Every Sunday at 6 PM") && JSON.stringify(nexts) === JSON.stringify(listed().sort((/** @type {Routine} */ x, /** @type {Routine} */ y) => Number(Boolean(y.built_in)) - Number(Boolean(x.built_in))).map((/** @type {Routine} */ routine) => routine.next_run)), JSON.stringify(nexts));
        check("…in plain words", !/cron|executor|schedul|routine|prompt/i.test(text), text);
        const menuOf = (/** @type {string} */ name) => `[...${rowOf(name)}.querySelectorAll(".routine-act")].map((b) => b.getAttribute("aria-label")).join("|")`;
        check("Lore's own can be paused but not removed", await js(menuOf("Evening check-in")) === "Run now" && await js(menuOf(SUNDAY)) === "Run now|Remove", `${await js(menuOf("Evening check-in"))} / ${await js(menuOf(SUNDAY))}`);
        await shot("automations");
        // Every action sits on its card: no menu to open, nothing to be cut off.
        check("no row hides its actions behind a ⋯", await js(`!document.querySelector("#content [aria-label^='More for'], #content .row-menu-items")`));
        await js(`${rowOf("Evening check-in")}.querySelector(".switch").click()`);
        check("the switch pauses it, and the CLI keeps that", await waitFor(`${rowOf("Evening check-in")}?.querySelector(".switch").getAttribute("aria-checked") === "false"`) && listed().find((/** @type {Routine} */ r) => r.id === "checkin").paused === true);
        check("…so it shows paused after a fresh read", await js(`window.lore.routines().then((all) => all.find((r) => r.id === "checkin").paused)`) === true && (await js(`${rowOf("Evening check-in")}.textContent`)).includes("Paused"));
        await js(`${rowOf(SUNDAY)}.querySelector("[aria-label='Change time']").click()`);
        await waitFor(`Boolean(document.querySelector("dialog.form-sheet[open] select"))`);
        await js(`{ const [cadence, , hour] = document.querySelectorAll("dialog.sheet[open] select"); cadence.value = "daily"; cadence.dispatchEvent(new Event("change")); hour.value = "7"; }`);
        check("Change time hides the day for a daily rhythm, and the row shows the choice", await js(`(() => { const [cadence, day] = document.querySelectorAll("dialog.sheet[open] select"); return day.closest(".form-row").hidden && cadence.closest(".form-row").querySelector(".form-value").textContent === "Every day"; })()`));
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        check("…and saves the new time", await waitFor(`${rowOf(SUNDAY)}?.textContent.includes("Every day at 7 AM")`) && mine().hour === 7 && mine().cadence === "daily", JSON.stringify(mine()));
        const readsAtRun = readings.length;
        const toldAtRun = notes.length;
        // APP-271: held open until the walk has seen its row running, then let land.
        readingHeld = new Promise((done) => { releaseReading = () => done(undefined); });
        await js(`${rowOf(SUNDAY)}.querySelector(".routine-act[aria-label='Run now']").click()`);
        await until(() => readings.length > readsAtRun, 10_000);
        check("Run now hands the owner's sentence to Lore's quiet reading", readings.length === readsAtRun + 1 && readings.at(-1)?.ask === SUNDAY, JSON.stringify(readings.slice(readsAtRun)));
        check("…and its row says it is running until the reading is done", await waitFor(`${rowOf(SUNDAY)}.textContent.includes("Running now")`), await js(`${rowOf(SUNDAY)}.textContent`));
        releaseReading();
        await until(() => notes.length > toldAtRun, 15_000);
        check("…which writes private memories and says so, named by its sentence", notes.length === toldAtRun + 1 && notes[toldAtRun].words.title === `“${SUNDAY}”` && notes[toldAtRun].words.body === "2 new memories. 1 looks worth selling.", JSON.stringify(notes.slice(toldAtRun).map((n) => n.words)));
        check("…and records what it found", await until(() => mine().result === "2 new memories", 5000), JSON.stringify(mine()));
        check("…then says it is done, once, without a second banner", await waitFor(`document.body.textContent.includes(${JSON.stringify(`“${SUNDAY}” is done · 2 new memories`)})`) && notes.length === toldAtRun + 1, JSON.stringify(notes.slice(toldAtRun).map((n) => n.words)));
        await js(`window.__lore.show("inbox")`);
        // APP-283: what a routine wrote is one Inbox row, named by the routine's sentence.
        check("the Inbox names it by its sentence alone", await waitFor(`${card}?.querySelector(".say")?.textContent === ${JSON.stringify(`“${SUNDAY}” · 2 new memories · 1 worth selling`)}`), await js(`${card}?.textContent`));
        await shot("automations-today-owner-routine");
        await js(`window.__lore.show("automations")`);
        // The owner pressed Run now and went elsewhere: a run that finds nothing still says it finished.
        const told = notes.length;
        window.hide();
        await js(`${rowOf("Read connected apps")}.querySelector(".routine-act[aria-label='Run now']").click()`);
        await until(() => notes.length > told, 10_000);
        const away = notes.slice(told).map((n) => n.words);
        check("Run now away from Lore ends with one banner saying it is done", away.length === 1 && away[0].title === "“Read connected apps” is done" && away[0].body === "Nothing new", JSON.stringify(away));
        // Back on screen without taking the keyboard from whoever is at this Mac.
        window.showInactive();
        // Paused for days, then resumed: it waits for its next hour instead of running at once.
        const checkInOf = () => listed().find((/** @type {Routine} */ r) => r.id === "checkin");
        python("automation.Routines().save('checkin', last_run=now - timedelta(days=4), since=now - timedelta(days=4))");
        await js(`window.__lore.event({ type: "changed" })`);
        await waitFor(`${rowOf("Evening check-in")}?.querySelector(".switch").getAttribute("aria-checked") === "false"`);
        // APP-271: the clock's look that a change sets off (routines:change, then schedule.check()) has run, and would
        // have run the check-in had it been owed, in place of two and a half seconds; the same for the new time below.
        const resumedFrom = lookedAt.schedule.started;
        await js(`${rowOf("Evening check-in")}.querySelector(".switch").click()`);
        await waitFor(`${rowOf("Evening check-in")}?.querySelector(".switch").getAttribute("aria-checked") === "true"`);
        await lookedSince("schedule", resumedFrom);
        // APP-271: the CLI asked once for the check, not once per term.
        const resumed = checkInOf();
        check("resuming a check-in paused for days never runs it at once", !resumed.due && !resumed.paused && Date.parse(resumed.next_run) > Date.now() && resumed.last_run.startsWith(new Date(Date.now() - 4 * 86400_000).toISOString().slice(0, 10)), JSON.stringify(resumed));
        // Moved to an hour that already passed today: it waits for tomorrow's.
        const earlier = (new Date().getHours() + 23) % 24;
        await js(`${rowOf("Evening check-in")}.querySelector("[aria-label='Change time']").click()`);
        await waitFor(`Boolean(document.querySelector("dialog.form-sheet[open] select"))`);
        await js(`{ const [cadence, , hour] = document.querySelectorAll("dialog.sheet[open] select"); cadence.value = "daily"; cadence.dispatchEvent(new Event("change")); hour.value = "${earlier}"; }`);
        const movedFrom = lookedAt.schedule.started;
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        await waitFor(`${rowOf("Evening check-in")}?.textContent.includes("Every day at")`);
        await lookedSince("schedule", movedFrom);
        const moved = checkInOf();
        check("…and moving it to an hour already past waits for tomorrow", moved.hour === earlier && !moved.due && Date.parse(moved.next_run) - Date.now() > 20 * 60 * 60_000 && moved.last_run.startsWith(new Date(Date.now() - 4 * 86400_000).toISOString().slice(0, 10)), JSON.stringify(moved));
        await js(`document.querySelector("#new-open").click(); document.querySelector("#new-menu [data-new=automation]").click()`);
        await waitFor(`document.querySelector("dialog.sheet[open] textarea")`);
        const sheetRows = `[...document.querySelectorAll("dialog.form-sheet[open] .form-row:not([hidden])")].map((r) => r.querySelector(".form-label").textContent + "=" + r.querySelector(".form-value").textContent).join("|")`;
        check("New automation opens on its prompt, with Create held until there is one", await js(`document.activeElement === document.querySelector("dialog.sheet[open] textarea") && document.querySelector("dialog.sheet[open] .btn.primary").textContent === "Create" && document.querySelector("dialog.sheet[open] .btn.primary").disabled`));
        check("…a Schedule of Repeat, On and At, defaulting to Sunday at 6 PM", await js(sheetRows) === "Repeat=Every week|On=Sunday|At=6 PM", await js(sheetRows));
        check("…offering only what Lore runs", await js(`[...document.querySelector("dialog.sheet[open] select").options].map((o) => o.value).join()`) === "daily,weekdays,weekly");
        await shot("automations-new-empty");
        await js(`{ const t = document.querySelector("dialog.sheet[open] textarea"); t.value = "Each Friday, pick one memory worth selling"; t.dispatchEvent(new Event("input", { bubbles: true })); }`);
        await shot("automations-new");
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        check("New automation adds one from a plain sentence and a time", await waitFor(`${rowOf("Each Friday, pick one memory worth selling")}`) && (await js(`${rowOf("Each Friday, pick one memory worth selling")}.textContent`)).includes("Every Sunday at 6 PM"));
        // A title names it; the sentence is still what Lore does. ⌘↩ creates it from the prompt.
        await js(`document.querySelector("#new-open").click(); document.querySelector("#new-menu [data-new=automation]").click()`);
        await waitFor(`document.querySelector("dialog.sheet[open] textarea")`);
        await js(`{ const f = document.querySelector("dialog.sheet[open]"); f.querySelector(".form-title").value = "Morning notes"; const t = f.querySelector("textarea"); t.value = "Remember what I wrote this morning"; t.dispatchEvent(new Event("input", { bubbles: true })); const [cadence, day, hour] = f.querySelectorAll("select"); day.value = "4"; day.dispatchEvent(new Event("change")); hour.value = "8"; hour.dispatchEvent(new Event("change")); t.focus(); }`);
        check("…the weekly day shows what was picked", await js(sheetRows) === "Repeat=Every week|On=Friday|At=8 AM", await js(sheetRows));
        await js(`document.querySelector("dialog.sheet[open] textarea").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }))`);
        check("…and ⌘↩ adds it under its own title", await waitFor(`${rowOf("Morning notes")}`) && (await js(`${rowOf("Morning notes")}.textContent`)).includes("Every Friday at 8 AM") && listed().some((/** @type {Routine} */ r) => r.name === "Morning notes"));
        // An automation opens to what it does: Lore's own say so; the owner's own can be reworded.
        const openSheet = `(document.querySelector("dialog.sheet[open]")?.textContent ?? "")`;
        const savePrimary = `document.querySelector("dialog.sheet[open] .btn.primary")`;
        await js(`${rowOf("Evening check-in")}.click()`);
        check("clicking one of Lore's own opens what it does, with Run now and Save", await waitFor(`${openSheet}.includes("asks you up to three questions")`) && !(await js(`Boolean(document.querySelector("dialog.sheet[open] textarea"))`)) && await js(`[...document.querySelectorAll("dialog.sheet[open] .btn")].map((b) => b.textContent).join("|")`) === "Run now|Save", await js(openSheet));
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await js(`${rowOf(SUNDAY)}.click()`);
        await waitFor(`document.querySelector("dialog.sheet[open] textarea")?.value === ${JSON.stringify(SUNDAY)}`);
        await shot("automations-open");
        await js(`{ const t = document.querySelector("dialog.sheet[open] textarea"); t.value = "Every Sunday, remember what I read and watched this week"; t.dispatchEvent(new Event("input", { bubbles: true })); }`);
        await js(`${savePrimary}.click()`);
        const REWORDED = "Every Sunday, remember what I read and watched this week";
        check("…and one of the owner's own can be reworded, kept by the CLI", await waitFor(`${rowOf(REWORDED)}`) && listed().some((/** @type {Routine} */ r) => r.about === REWORDED));
        await js(`${rowOf(REWORDED)}.querySelector(".routine-act[aria-label='Remove']").click()`);
        check("Remove takes the owner's own away for good", await waitFor(`!${rowOf(REWORDED)}`) && !listed().some((/** @type {Routine} */ r) => r.about === REWORDED));
        await js(`${rowOf("Read connected apps")}.querySelector(".switch").click()`);
        check("pausing the reading shows on its row", await waitFor(`${rowOf("Read connected apps")}?.textContent.includes("Paused")`), await js(`${rowOf("Read connected apps")}?.textContent`));
        await js(`window.__lore.show("automations")`);
        // APP-271: the routines read again after the pause have landed, in place of a fixed wait.
        await idle();
        await shot("automations-after");
        // APP-246: a suggested collection reads as its name and what's in it, and Review shows only those memories.
        const kept = await js(`window.lore.snapshot().then((s) => s.library.items.filter((m) => m.status === "private").map((m) => ({ id: m.id, title: m.title })))`);
        writeFileSync(join(process.env.LORE_DESKTOP_USER_DATA ?? "", "collection-suggestions.json"), JSON.stringify([{ at: new Date().toISOString(), title: "Pricing lessons", memories: [kept[0].id], from: "Suggest collections" }]));
        await js(`window.__lore.show("inbox")`);
        await js(`window.__lore.event({ type: "changed" })`);
        const suggested = `[...document.querySelectorAll("#content .irow.suggestion")].find((r) => r.textContent.includes("“Pricing lessons”"))`;
        check("a suggested collection is one Inbox row saying how much is in it, with Done", await waitFor(`${suggested}?.querySelector(".say")?.textContent === "Lore suggests a collection: “Pricing lessons” · 1 memory"`) && await js(`Boolean(${suggested}.querySelector(".done"))`), await js(`${suggested}?.textContent`));
        await shot("automations-suggested-collection");
        await js(`${suggested}.querySelector(".verb").click()`);
        check("…Review shows only its memories, ticked, with no search", await waitFor(`document.querySelectorAll("#content .pick").length === 1`) && await js(`document.querySelector("#content .pick input").checked && !document.querySelector("#content .pick-find") && document.querySelector("#content .wizard-lead").textContent === "Lore picked this memory. Untick any that don't belong."`), await js(`document.querySelector("#content").textContent`));
        await shot("automations-suggestion-review");
        await js(`[...document.querySelectorAll("#content .pick-foot .btn")].find((b) => b.textContent === "Choose from all memories").click()`);
        check("…and every memory is one tap away, the suggestion's still ticked", await waitFor(`Boolean(document.querySelector("#content .pick-find"))`) && await js(`document.querySelectorAll("#content .pick").length === ${kept.length} && document.querySelectorAll("#content .pick input:checked").length === 1`), await js(`document.querySelectorAll("#content .pick").length`));
        // Stepping away keeps the suggestion; only putting its memories in clears it from Today.
        await js(`[...document.querySelectorAll("#content .pick-foot .btn")].find((b) => b.textContent === "Cancel").click()`);
        await js(`window.__lore.show("inbox")`);
        check("…Cancel leaves the suggestion in the Inbox to come back to", await waitFor(`Boolean(${suggested})`) && await js(`window.lore.suggestions().then((all) => all.length === 1)`));
        await js(`${suggested}.querySelector(".verb").click()`);
        await waitFor(`document.querySelectorAll("#content .pick").length === 1`);
        await js(`[...document.querySelectorAll("#content .pick-foot .btn")].find((b) => b.textContent === "Continue").click()`);
        check("…and Continue puts its memories in, then clears it", await waitFor(`Boolean(document.querySelector("#content .collection-name"))`) && await until(() => js(`window.lore.suggestions().then((all) => all.length === 0)`), 5000, 20));
      } else if (scenario === "checkin") {
        // AUT-008: the check-in whose hour passed an hour ago runs at launch, on what was read in since it last judged.
        const repo = join(__dirname, "../../..");
        const loreCli = (/** @type {string[]} */ args) => uvRun(["lore", ...args], { cwd: repo, env: process.env, encoding: "utf8" });
        const python = (/** @type {string} */ code) => uvRun(["python", "-c", `from datetime import datetime, timedelta, timezone\nfrom lore import automation\nnow = datetime.now(timezone.utc)\n${code}`], { cwd: repo, env: process.env, encoding: "utf8" });
        const checkin = () => JSON.parse(loreCli(["automation", "list", "--json"])).find((/** @type {Routine} */ routine) => routine.id === "checkin");
        /** The next day, an hour after the check-in's hour: yesterday's run and anything it posted are a day old. */
        const nextDay = () => {
          python("automation.Routines().save('checkin', last_run=now - timedelta(days=1), since=now - timedelta(days=2))");
          const file = join(process.env.LORE_DESKTOP_USER_DATA ?? "", "check-in.json");
          const posted = JSON.parse(require("node:fs").readFileSync(file, "utf8"));
          writeFileSync(file, JSON.stringify({ ...posted, at: new Date(Date.now() - 24 * 60 * 60_000).toISOString() }));
        };
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await until(() => checkIns.length, 15_000);
        check("the launch looks over the one item read in since, and reads nothing itself", checkIns.length === 1 && checkIns[0].items.length === 1 && checkIns[0].items[0].title === "Pushed back on the Acme pricing call" && !readings.length, JSON.stringify({ checkIns, readings }));
        const card = `document.querySelector("#content .irow.checkin")`;
        const asking = (/** @type {{words: {title: string}}} */ note) => note.words.title === "Five minutes on today?";
        await js(`window.__lore.show("inbox")`);
        await until(() => checkin().result, 20_000);
        await js(`window.__lore.event({ type: "changed" })`);
        // APP-271: its notification is out and the refresh has been drawn, in place of a fixed wait.
        await until(() => notes.some(asking), 5000);
        await idle();
        const note = notes.find(asking);
        check("a day worth asking about is one notification naming the thing", notes.filter(asking).length === 1 && note?.words.body === "You held the price on the Acme call. What made you hold firm?", JSON.stringify(notes.map((n) => n.words)));
        check("…an Inbox row says so, with one verb", await waitFor(`${card}?.querySelector(".say")?.textContent === "Check-in: 1 question about today" && ${card}.querySelector(".verb").textContent === "Answer"`), await js(`document.querySelector("#content").textContent`));
        check("…and the dock keeps a red 1 for it", badges.at(-1) === 1, JSON.stringify(badges));
        const recorded = checkin().result;
        check("…recorded as the routine's last result", recorded === "Asked about 1 thing", recorded);
        check("…and the thread is not listed twice", !(await js(`Boolean(document.querySelector("#content .irow.task"))`)));
        await shot("checkin-today");
        note?.handlers.click();
        check("the notification opens a thread with the question already asked", await waitFor(`document.querySelector("#title").textContent === "Evening check-in"`) && await waitFor(`document.querySelector("#log").textContent.includes("What made you hold firm?")`));
        check("…and the owner can answer straight away", await js(`!document.querySelector("#capture-input").disabled`) && (await js(`document.querySelector("#eyebrow")?.textContent ?? ""`)) === "Waiting for you · Five minutes on today", await js(`document.querySelector("#eyebrow")?.textContent ?? ""`));
        await shot("checkin-thread");
        await js(`document.querySelector("#task-back").click()`);
        await waitFor(card);
        // Run now later the same day leaves today's questions where they are.
        await js(`window.__lore.show("automations")`);
        const checkInRow = `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector("b")?.textContent === "Evening check-in")`;
        await waitFor(checkInRow);
        const before = checkin().last_run;
        // APP-271: Run now is answered once the run, and anything it set off, is done (routines:run waits for both); then
        // the app has gone quiet. In place of reading the CLI until the run was recorded, then a second and a half.
        const ranFrom = ipc.length;
        await js(`${checkInRow}.querySelector(".routine-act[aria-label='Run now']").click()`);
        await until(() => answeredSince("routines:run", ranFrom), 20_000);
        await idle();
        await js(`window.__lore.show("inbox")`);
        const ran = checkin();
        check("Run now on the same day keeps today's card, its questions and the dock's 1", await waitFor(card) && badges.at(-1) === 1 && (await js(`window.lore.checkIn()`))?.questions[0].question === "You held the price on the Acme call. What made you hold firm?" && ran.result === "Asked about 1 thing" && checkIns.length === 1 && ran.last_run !== before, `${JSON.stringify(badges)} · ${ran.result} · ${checkIns.length} looks`);
        // The next evening brings in something new; yesterday's unanswered questions give way to today's.
        nextDay();
        writeFileSync(join(S, "Edge Vault", "three.md"), "# Dropped the Globex renewal\n\nWalked away from the renewal; no reason written down.\n");
        loreCli(["sources", "read"]);
        require("electron").powerMonitor.emit("resume");
        await until(() => notes.filter(asking).length >= 2, 20_000);
        const second = notes.filter(asking)[1];
        check("the next day's check-in asks about the next day's item", checkIns.length === 2 && checkIns[1].items.map((item) => item.title).join() === "Dropped the Globex renewal" && second?.words.body === "What made you walk away from the Globex renewal?", JSON.stringify({ items: checkIns[1]?.items, note: second?.words }));
        second?.handlers.click();
        const log = `document.querySelector("#log").textContent`;
        check("…and its notification opens a new thread with only that day's question", await waitFor(`${log}.includes("walk away from the Globex renewal?")`) && !(await js(`${log}.includes("What made you hold firm?") || ${log}.includes("Started over")`)), await js(log));
        await shot("checkin-thread-day-two");
        await js(`document.querySelector("#task-back").click()`);
        await waitFor(card);
        await js(`${card}.querySelector(".done").click()`);
        check("Done takes the row away and clears the dock", await waitFor(`!(${card})`) && await until(() => badges.at(-1) === 0, 4000), JSON.stringify(badges));
        check("…for good, and its thread with it", await js(`window.lore.checkIn()`) === null && !(await js(`window.lore.tasks().then((all) => all.some((t) => t.kind === "evening"))`)));
        // APP-269, APP-270: what the retired faq walk drew, then the retired jobs walk, launched dark as both were: the
        // account menu over the page, closed by Chromium's own Escape, and the FAQ it leads to. What the menu and the FAQ
        // say is test/unit/renderer-account-menu.test.cjs and test/unit/renderer-faq.test.cjs.
        await js(`window.__lore.show("settings")`);
        await waitFor(`document.querySelector("#title").textContent === "Settings"`);
        await js(`document.querySelector("#account").click()`);
        check("the account menu opens, with focus on its first item", await waitFor(`document.querySelector("#account-menu").matches(":popover-open") && document.activeElement === document.querySelector("#account-menu [data-view=settings]")`));
        await shot("account-menu");
        await key("keyDown", "Escape");
        check("Escape closes it", await waitFor(`!document.querySelector("#account-menu").matches(":popover-open") && document.querySelector("#account").getAttribute("aria-expanded") === "false"`));
        await js(`document.querySelector("#account").click(); document.querySelector("#account-menu [data-view=faq]").click()`);
        check("Help & FAQ lands on the FAQ, and the menu closes", await waitFor(`document.querySelector("#title").textContent === "FAQ"`) && await js(`!document.querySelector("#account-menu").matches(":popover-open")`));
        await shot("faq");
      } else {
        // APP-270, from the retired provision walk. Fix 4: setup failed. Every button must answer, the banner must say
        // so, and Try again must recover. The banner's words and Try again's call are test/unit/renderer-provision.test.cjs.
        await waitFor(`document.querySelector("#welcome-note").textContent.includes("could not finish setting up")`);
        check("banner names the failure", await js(`document.querySelector("#welcome-note").textContent`) === "Lore could not finish setting up on this Mac.");
        check("Try again is offered", await js(`!document.querySelector("#welcome-retry").hidden`));
        const rejection = await js(`window.lore.tasks().then(() => "resolved", (e) => e.message)`);
        check("IPC answers before setup finished", /still setting up/.test(rejection), rejection);
        await shot("provision-failed");
        failSetup = false;
        await js(`document.querySelector("#welcome-retry").click()`);
        check("retry recovers to sign-in", await waitFor(`!document.querySelector("#welcome").classList.contains("provisioning") && document.querySelector("#welcome-note").textContent === ""`));
        const status = await js(`window.lore.tasks().then((t) => Array.isArray(t) ? "ok" : "odd", (e) => e.message)`);
        check("agent answers after retry", status === "ok", status);
        await shot("provision-recovered");
        await js(`window.__lore.signIn()`);
        check("the Inbox lists each draft as a row", await waitFor(`document.querySelectorAll("#content .irow.draft").length === 2`));
        await js(`document.querySelector("#content .irow.draft .verb").click()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Approve what to sell")`);
        check("two drafts to approve", await js(`document.querySelectorAll("#content .draft-title").length`) === 2);

        // Fix 2: an edit survives the agent's next "changed" event (fires on every bash call).
        await js(`const t = document.querySelector("#content .draft-title"); t.value = "Edited by the owner"; t.dispatchEvent(new Event("input"));`);
        // APP-271: each "changed" is a load; the loads it started have read the snapshot and the app has gone quiet, so
        // the page has been drawn again from them, in place of a second and a half each.
        const reloaded = async (/** @type {number} */ from, /** @type {number} */ loads) => {
          await until(() => { const reads = calls.filter((call, at) => at >= from && ipc[at] === "snapshot:read"); return reads.length >= loads && reads.every((call) => call.answered > 0); }, 10_000);
          await idle();
        };
        let loadsFrom = ipc.length;
        await js(`window.__lore.event({ type: "changed" })`);
        await reloaded(loadsFrom, 1);
        check("approval edit survives a re-render", await js(`document.querySelector("#content .draft-title").value`) === "Edited by the owner");
        loadsFrom = ipc.length;
        await js(`window.__lore.event({ type: "changed" }); window.__lore.event({ type: "changed" })`);
        await reloaded(loadsFrom, 2);
        check("…and repeated ones", await js(`document.querySelector("#content .draft-title").value`) === "Edited by the owner");

        // Fix 3: Enter in a memory card's title moves to the text instead of keeping the memory.
        await js(`window.__lore.preview({ type: "memories", id: "preview-1", task: null, entries: [{ title: "A title", content: "Some content", project: "p" }] })`);
        await js(`document.querySelector("#request .draft-title").focus()`);
        await key("keyDown", "Return"); await key("char", "Return"); await key("keyUp", "Return");
        const movedOn = await waitFor(`document.activeElement?.tagName === "TEXTAREA"`, 8);
        check("card is still up after Enter in title", await js(`Boolean(document.querySelector("#request form"))`));
        check("focus moved to the content field", movedOn, await js(`document.activeElement?.tagName`));
        check("nothing was kept", !(await js(`document.querySelector("#log").textContent.includes("Keep")`)));
        await js(`window.__lore.event({ type: "dismiss", id: "preview-1" })`);

        // open_url: one card, two stages, same size; the page opens through the window-open handler.
        await js(`window.open = (url) => { window.__opened = url; return null; }; true`);
        await js(`window.__lore.preview({ type: "open", id: "preview-open", task: null, title: "Fund the test buyer", url: "https://portal.cdp.coinbase.com/products/faucet", note: "Free Coinbase login. Keep Base Sepolia and USDC selected, paste 0x3f9a…d21c and press Send." })`);
        const buttons = () => js(`[...document.querySelectorAll("#request .actions button")].map((b) => b.textContent).join("|")`);
        check("stage one names the step and the host", await js(`document.querySelector("#request .q").textContent`) === "Fund the test buyer" && await buttons() === "Not now|Open portal.cdp.coinbase.com");
        const before = await js(`document.querySelector("#request form").offsetHeight`);
        await js(`document.querySelector("#request").scrollIntoView({ block: "center" }); true`);
        await shot("open-stage-one");
        await js(`document.querySelector("#request form").requestSubmit()`);
        check("Open goes through the window-open handler", await waitFor(`window.__opened === "https://portal.cdp.coinbase.com/products/faucet"`, 8), await js(`window.__opened`));
        check("stage two keeps the task heading and swaps the buttons", await js(`document.querySelector("#request .q").textContent`) === "Fund the test buyer" && await buttons() === "I need help|Done");
        check("the card keeps its size between stages", await js(`document.querySelector("#request form").offsetHeight`) === before);
        await js(`document.querySelector("#request").scrollIntoView({ block: "center" }); true`);
        await shot("open-stage-two");
        await js(`document.querySelector("#request form").requestSubmit()`);
        check("Done closes the card and echoes the owner", await waitFor(`!document.querySelector("#request form") && document.querySelector("#log").textContent.endsWith("Done")`, 8));
        // Question cards: the agent's recommended option starts selected and wears a chip; no options means one text field;
        // the card lands below the sticky header; a card waiting in another thread names itself in the locked composer.
        await js(`window.__lore.openTask("capture")`);
        await js(`window.__lore.preview({ type: "question", id: "preview-q", task: null, questions: [{ question: "What should a publication cost?", header: "Price", multiSelect: false, options: [{ label: "$0.05", description: "Higher", recommended: false }, { label: "$0.01", description: "Low first price", recommended: true }] }, { question: "Paste your payout address.", header: "Payout", multiSelect: false, options: [], format: "evm_address" }] })`);
        check("the card lands below the sticky header", await js(`document.querySelector("#request form").getBoundingClientRect().top >= document.querySelector("#main header").getBoundingClientRect().bottom`));
        check("drafts wait in the capture thread that can draft them", await js(`[...document.querySelectorAll("#main h2")].some((h) => h.textContent === "Approve what to sell")`));
        check("the model's recommended option starts selected and is chipped", await js(`document.querySelector("#request input:checked")?.value`) === "$0.01" && await js(`document.querySelector("#request .choice:has(input:checked)").textContent`) === "$0.01RecommendedLow first price");
        // MON-047: by card first, recommended, with no address to give; Coinbase and a wallet app after it.
        check("the payout question is the guided card: By card first, recommended, and no address asked", await js(`(() => { const f = document.querySelector("#request fieldset.payout"); return Boolean(f) && f.querySelector("input:checked")?.value === "By card" && Boolean(f.querySelector(".choice:has(input:checked) .chip")) && /Stripe/.test(f.querySelector(".payout-steps").textContent) && f.querySelector(".other-answer").hidden; })()`));
        check("…and its button says it goes to Stripe", await js(`document.querySelector("#request form .actions .btn.primary").textContent`) === "Continue with Stripe");
        await shot("payout-card-by-card");
        await js(`(() => { const f = document.querySelector("#request fieldset.payout"); f.querySelectorAll("input[type=radio]")[1].click(); return true; })()`);
        check("choosing Coinbase shows its taps and one address field", await js(`(() => { const f = document.querySelector("#request fieldset.payout"); return /Set the network to Base/.test(f.querySelector(".payout-steps").textContent) && !f.querySelector(".other-answer").hidden && f.querySelectorAll("input[type=text]").length === 1; })()`));
        await js(`(() => { const f = document.querySelector("#request fieldset.payout"); f.querySelectorAll("input[type=radio]")[2].click(); return true; })()`);
        check("choosing a wallet app swaps in its taps", await js(`/Open your wallet and tap Receive/.test(document.querySelector("#request .payout-steps").textContent)`));
        await js(`(() => { const a = document.querySelector("#request fieldset.payout .other-answer"); a.value = "abandon ability able about above absent absorb abstract absurd abuse access accident"; a.dispatchEvent(new Event("input")); return true; })()`);
        check("a pasted recovery phrase is cleared on the spot, with a warning", await js(`document.querySelector("#request fieldset.payout .other-answer").value === "" && /recovery phrase/.test(document.querySelector("#request .payout-status").textContent)`));
        await js(`(() => { const a = document.querySelector("#request fieldset.payout .other-answer"); a.value = "0x0c270534cfcecc9224edb903ef5dd70410d08166"; a.dispatchEvent(new Event("input")); return true; })()`);
        check("a good address is confirmed back, shortened", await js(`document.querySelector("#request .payout-status").textContent`) === "✓ Payments will land at 0x0c27…8166.");
        await js(`document.querySelector("#request fieldset.payout").scrollIntoView({ block: "center" }); true`);
        await shot("payout-card");
        await js(`document.querySelector("#request fieldset.payout .other-answer").value = ""; true`);
        check("the chip sits to the right of the label on the same row", await js(`(() => { const c = document.querySelector("#request .choice:has(input:checked)"); const [label, chip] = [c.querySelector("span:not(.chip)"), c.querySelector(".chip")].map((n) => n.getBoundingClientRect()); return chip.left > label.right && Math.abs(chip.top - label.top) < 12 && chip.right <= c.getBoundingClientRect().right; })()`));
        await js(`document.querySelectorAll("#request .other-answer")[1].value = "abandon ability able about above absent absorb abstract absurd abuse access accident"; document.querySelector("#request form").requestSubmit()`);
        // The time a wrongly taken answer would take to close the card, which it must not: there is nothing else to watch.
        await sleep(100);
        check("a recovery phrase is refused before it reaches the agent", await js(`Boolean(document.querySelector("#request form"))`));
        await js(`document.querySelectorAll("#request .other-answer")[1].value = "0x0c270534cfcecc9224edb903ef5dd70410d08166"; document.querySelector("#request form").requestSubmit()`);
        check("the echo labels and shortens the address", await waitFor(`document.querySelector("#log").textContent.endsWith("$0.01 · Payout: 0x0c27…8166")`, 8), await js(`document.querySelector("#log").textContent.slice(-80)`));
        await js(`window.__lore.event({ type: "message", task: "capture", text: "Ready." })`);
        check("owner turns are right-aligned bubbles while Lore stays open", await js(`(() => { const owner = document.querySelector("#log .line.owner"); const bubble = owner?.querySelector("p"); const lore = document.querySelector("#log .line:not(.owner) .md"); return Boolean(owner && bubble && lore) && Math.abs(bubble.getBoundingClientRect().right - owner.getBoundingClientRect().right) < 1 && bubble.getBoundingClientRect().left > owner.getBoundingClientRect().left + 64 && !owner.querySelector(".mark, .you") && getComputedStyle(bubble).backgroundColor !== "rgba(0, 0, 0, 0)" && getComputedStyle(lore).backgroundColor === "rgba(0, 0, 0, 0)"; })()`));
        check("…and a screen reader hears who said each line", await js(`[...document.querySelectorAll("#log > .line:not(.thinking)")].every((line) => line.querySelector(":scope > .sr-only")?.textContent === (line.classList.contains("owner") ? "You: " : "Lore: "))`));
        await shot("conversation-bubble");
        const room = `(() => { const main = document.querySelector("#main"); return parseFloat(getComputedStyle(main).scrollPaddingBottom) - document.querySelector("#composer").offsetHeight; })()`;
        await js(`{ const field = document.querySelector("#capture-input"); field.value = "one\\ntwo\\nthree\\nfour\\nfive\\nsix"; field.dispatchEvent(new Event("input")); }`);
        check("a thread keeps what it scrolls to clear of the composer as the composer grows", await waitFor(`document.querySelector("#composer").offsetHeight > 100 && ${room} === 34`), String(await js(room)));
        await js(`{ const field = document.querySelector("#capture-input"); field.value = ""; field.dispatchEvent(new Event("input")); }`);
        await js(`window.__lore.event({ type: "working", task: "capture", active: true }); window.__lore.event({ type: "message", task: "capture", text: "I'll check the store is serving the new price." })`);
        check("an open turn ends in a shimmering line saying what Lore is doing", await waitFor(`(() => { const last = document.querySelector("#log").lastElementChild; return last?.classList.contains("thinking") && last.querySelector(".shimmer")?.textContent === "Reading this…" && last.textContent === "Reading this…"; })()`, 8) && await js(animating(`document.querySelector("#log .thinking .shimmer")`, "shimmer")));
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Setting up your store…", status: true })`);
        check("a tool's status relabels the bubble instead of replacing what Lore said", await js(`document.querySelector("#log .thinking").textContent`) === "Setting up your store…" && /new price/.test(await js(`document.querySelector("#log").textContent`)));
        await shot("thinking-bubble");
        // APP-222: the agent's tool calls, as steps in the owner's words.
        const stepEvent = (id, kind) => js(`window.__lore.event(${JSON.stringify({ type: "step", task: "capture", id, ...(kind ? { kind } : { done: true }) })})`);
        await stepEvent("s1", "read-memory");
        check("a step that starts takes the working line's place, shimmering, in plain words", await js(`(() => { const rows = [...document.querySelectorAll("#log .line.steps .step")]; return !document.querySelector("#log .thinking") && rows.length === 1 && rows[0].textContent === "Read 1 memory" && Boolean(rows[0].querySelector(".shimmer")); })()`), await js(`document.querySelector("#log .line.steps")?.textContent ?? ""`));
        // These two give each step a measurable time to have taken, which the row then says.
        await sleep(200);
        await stepEvent("s1");
        await stepEvent("s2", "read-memory");
        await sleep(100);
        await stepEvent("s2");
        await stepEvent("s3", "status");
        const stepText = `[...document.querySelectorAll("#log .line.steps .step")].map((r) => r.textContent).join(" | ")`;
        check("steps of a kind in a row are one row with a count and how long they took; the current one shimmers", /^Read 2 memories\d+(\.\d)?s \| Checked your store$/.test(await js(stepText)) && await js(`document.querySelectorAll("#log .line.steps .shimmer").length === 1 && document.querySelector("#log .line.steps .step:last-child .shimmer") !== null && getComputedStyle(document.querySelector("#log .step .took")).fontVariantNumeric === "tabular-nums"`), await js(stepText));
        check("…never a tool's name, a command or a path", !/\b(bash|read|write|edit|tool|lore)\b|_|wrangler|npx|\//.test(await js(`document.querySelector("#log .line.steps").textContent`)), await js(`document.querySelector("#log .line.steps").textContent`));
        await shot("working-steps");
        // Two frames of the sweep, a moment apart, to show it moves. APP-271: pictures only, so only where they are kept.
        if (IMAGES) {
          writeFileSync(join(S, "shimmer-1.png"), (await window.webContents.capturePage()).toPNG());
          // The sweep's own time to move between the two frames.
          await sleep(450);
          writeFileSync(join(S, "shimmer-2.png"), (await window.webContents.capturePage()).toPNG());
        }
        const sweep = `(() => { const n = document.querySelector("#log .shimmer"); return [n.getAnimations()[0]?.currentTime ?? null, getComputedStyle(n).backgroundPosition]; })()`;
        const [time, light] = await js(sweep);
        // The sweep's own time to move, which is what this check measures.
        await sleep(300);
        const [later, moved] = await js(sweep);
        check("the shimmer sweeps: its animation runs on, and the light moves", await js(animating(`document.querySelector("#log .shimmer")`, "shimmer")) && typeof time === "number" && later > time && light !== moved, `${time} → ${later}, ${light} → ${moved}`);
        await stepEvent("s3");
        // Words ink in as the reply streams, and only the new ones.
        const inks = `[...document.querySelectorAll("#log .ink")].map((w) => w.textContent).join(" ")`;
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Your store is serving the new price" })`);
        check("a streaming reply's words ink in as they arrive", await js(inks) === "Your store is serving the new price", await js(inks));
        // A word inks in for its first 150 ms (INK_MS); these two let the words before the next delta finish theirs.
        await sleep(300);
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Your store is serving the new price for every buyer" })`);
        check("…and the next delta inks only its own words", await js(inks) === "for every buyer", await js(inks));
        await sleep(300);
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Your store is serving the new price for every buyer.\\n\\n\`\`\`\\nprice = 0.01 per piece\\n\`\`\`" })`);
        check("…never inside code", await js(`Boolean(document.querySelector("#log .line.live pre")) && !document.querySelector("#log pre .ink, #log code .ink") && document.querySelectorAll("#log .ink").length === 0`), await js(inks));
        await js(`window.__lore.event({ type: "message", task: "capture", text: "Your store is serving the new price for every buyer." })`);
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Checking", status: true })`);
        check("a finished reply and a re-render carry no ink", await js(`document.querySelectorAll("#log .ink").length === 0`));
        const fold = `document.querySelector("#log .line.steps")`;
        check("finished steps fold into one line: how many, and how long", /^3 steps · \d+(\.\d)?s$/.test(await js(`${fold}.querySelector(".steps-sum").textContent`)) && await js(`getComputedStyle(${fold}.querySelector(".steps-fold")).visibility === "hidden" && ${fold}.querySelector(".steps-sum").getAttribute("aria-expanded") === "false"`), await js(`${fold}.textContent`));
        await js(`${fold}.querySelector(".steps-sum").click()`);
        check("…which opens on click, over the app's one duration", await js(`${fold}.classList.contains("open") && ${fold}.querySelector(".steps-sum").getAttribute("aria-expanded") === "true" && getComputedStyle(${fold}.querySelector(".steps-fold")).transitionDuration.startsWith("0.12s")`), await js(`getComputedStyle(${fold}.querySelector(".steps-fold")).transitionDuration`));
        await js(`${fold}.scrollIntoView({ block: "center" })`);
        await shot("steps-open");
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Checking again", status: true })`);
        check("…and stays open through the next render", await js(`${fold}.classList.contains("open") && getComputedStyle(${fold}.querySelector(".steps-fold")).visibility === "visible"`));
        // Reduced motion: every sweep and ink stands still, and the words stay plain to read.
        await motion(true);
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Still checking" })`);
        check("under reduced motion nothing shimmers or inks in", await js(`(() => { const ink = document.querySelector("#log .ink"); return Boolean(ink) && getComputedStyle(ink).animationName === "none" && [...document.querySelectorAll(".shimmer")].every((n) => getComputedStyle(n).animationName === "none" && getComputedStyle(n).color !== "rgba(0, 0, 0, 0)"); })()`));
        await motion(false);
        await js(`window.__lore.event({ type: "message", task: "capture", text: "Still checking." })`);
        await js(`window.__lore.event({ type: "working", task: "capture", active: false })`);
        check("the bubble goes when the turn closes", !(await js(`Boolean(document.querySelector("#log .thinking, #log .shimmer"))`)));
        await js(`window.__lore.event({ type: "working", task: "deploy", active: true }); window.__lore.preview({ type: "open", id: "preview-wait", task: "deploy", title: "Get a wallet", url: "https://www.coinbase.com/wallet", note: "1. Create new wallet." })`);
        check("a card waiting in another thread replaces the composer with a row that opens it", await waitFor(`document.querySelector("#composer").hidden && document.querySelector(".composer-wait")?.textContent === "Lore is waiting on you in Open your store.Open"`, 8), await js(`document.querySelector(".composer-wait")?.textContent ?? ""`));
        await js(`document.querySelector(".composer-wait button").click()`);
        check("Open lands in the waiting thread with its card", await waitFor(`document.querySelector("#title").textContent === "Open your store" && Boolean(document.querySelector("#request form"))`, 8), await js(`document.querySelector("#title").textContent`));
        await js(`document.querySelector("#task-back").click()`);
        await waitFor(`document.querySelector("#title").textContent !== "Open your store"`, 8);
        await js(`window.__lore.event({ type: "dismiss", id: "preview-wait" }); window.__lore.event({ type: "working", task: "deploy", active: false })`);
        await waitFor(`![...document.querySelectorAll("#request .q")].some((q) => q.textContent === "Get a wallet")`, 8);
        await js(`window.__lore.preview({ type: "open", id: "preview-open-2", task: null, title: "See the payment land", url: "https://sepolia.basescan.org/address/0x1", note: "Token Transfers shows it." })`);
        await js(`document.querySelector("#request .actions button").click()`);
        check("Not now closes the card and echoes the owner", await waitFor(`!document.querySelector("#request form") && document.querySelector("#log").textContent.endsWith("Not now")`, 8));

        // Fix 1, seller: approve the last draft with no store. The confirmation must be visible where the drafts are.
        await js(`window.__lore.show("drafts")`);
        await js(`{ const b = [...document.querySelectorAll("#content button")].find((x) => x.textContent === "Approve"); b.click(); b.click(); }`);
        await waitFor(`document.querySelectorAll("#content .draft-title").length === 1`);
        check("a double click submits one edited decision", await js(`document.querySelectorAll("#content .draft-title").length`) === 1 && !(await js(`document.querySelector("#status .notice.attention")`)));
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Skip").click()`);
        await waitFor(`[...document.querySelectorAll("#content .request .q")].some((q) => q.textContent === "Open your store?")`);
        check("approving with no store offers to open one, one click away", await js(`[...document.querySelectorAll("#content .request button")].some((b) => b.textContent === "Open your store")`));
        check("the offer is said once, not again under Needs you", !(await js(`[...document.querySelectorAll("#content .row b")].some((b) => b.textContent === "Open your store")`)));
        check("approved title carried the edit", await js(`window.lore.snapshot().then((s) => s.publications.items.map((i) => i.title).join("|"))`) === "Edited by the owner");
        await shot("seller-approved-offer");
        await js(`[...document.querySelectorAll("#content .request button")].find((b) => b.textContent === "Not now").click()`);
        check("the offer can be left for later", !(await js(`[...document.querySelectorAll("#content .request .q")].some((q) => q.textContent === "Open your store?")`)));
        await js(`document.querySelector("#main").scrollTop = 1e6; window.__lore.show("settings")`);
        // APP-271: Settings drawn, and its reads landed, before saying where it is scrolled.
        await waitFor(`document.querySelector("#title").textContent === "Settings"`);
        await idle();
        check("each tab opens at its top, not where the last one was scrolled", await js(`document.querySelector("#main").scrollTop`) === 0);
        await js(`window.__lore.show("inbox")`);

        // Ledger: with no store there is nothing to read, and the section says so without a probe.
        await js(`window.__lore.show("store")`);
        // APP-271: the sales read Inventory starts has come back, in place of a fixed wait.
        await idle();
        const sales = await js(`document.querySelector("#content").textContent`);
        check("no Sales group without a store", !/(^|\|)Sales/.test(await js(`[...document.querySelectorAll("#content .igroup .label")].map((l) => l.textContent).join("|")`)), sales.slice(-160));
        await shot("store");

        // Fix 1, technical: a failing CLI call on Memories surfaces as an attention notice instead of vanishing.
        await js(`window.__lore.show("memories")`);
        await waitFor(`document.querySelectorAll("#content .invrow[data-key^=memory] .say").length >= 1`);
        await js(`[...document.querySelectorAll(".ptab")].find((t) => t.textContent.startsWith("All")).click()`);
        await waitFor(`document.querySelectorAll("#content .invrow[data-key^=memory] .say").length >= 1`);
        // Focus first, as a real click or Enter would; a synthetic click() leaves focus where it was.
        await js(`const link = document.querySelector("#content .invrow[data-key^=memory] .say"); link.focus(); link.click();`);
        // APP-282: a memory opens as its own page, as a bid does: title, body, actions, Activity, and properties beside it.
        await waitFor(`document.querySelector("#content .memory-page")`);
        const opened = await js(`document.querySelector("#content .memory-page .ptitle").textContent`);
        check("a memory opens as a page with its title in the breadcrumb, not a sheet", await js(`!document.querySelector("dialog.sheet") && document.querySelector("#title").textContent === document.querySelector("#content .memory-page .ptitle").textContent && document.querySelector("#task-back").textContent === "Inventory" && !document.querySelector("#task-back").hidden`), opened);
        check("…its body as prose, Activity at the foot, and Status, Source, Topic and Updated beside it", await js(`(() => { const page = document.querySelector("#content .memory-page"); return Boolean(page.querySelector(".md.read p")) && page.querySelector(".sec")?.textContent === "Activity" && page.querySelectorAll(".timeline .ev").length >= 1 && [...page.querySelectorAll(".page-side .prop dt")].map((d) => d.textContent).filter((t) => ["Status", "Source", "Topic", "Updated"].includes(t)).length === 4; })()`));
        await js(`document.querySelector("#content .page-actions [aria-label=More]").click()`);
        await waitFor(`Boolean(document.querySelector(".inv-menu:popover-open"))`, 8);
        check("memory actions: one way to sell it, Edit and More as labelled icons, Rename and Delete in the menu", await js(`(() => { const actions = document.querySelector("#content .page-actions"); const icons = [...actions.querySelectorAll(".icon-btn")].map((b) => b.getAttribute("aria-label")); const items = [...document.querySelectorAll(".inv-menu:popover-open [role=menuitem]")].map((b) => b.textContent); return /^(Draft for sale|Review draft)$/.test(actions.querySelector(".btn")?.textContent ?? "") && icons.join() === "Edit,More" && items.join() === "Rename,Delete" && document.querySelector(".inv-menu:popover-open .danger")?.textContent === "Delete"; })()`));
        await key("keyDown", "Escape");
        await waitFor(`!document.querySelector(".inv-menu:popover-open")`, 8);
        await shot("memory-actions");
        // APP-282: a memory sold on its own reads as its piece's row, off the Private tab; All steps through it too.
        const [place, count] = (await js(`document.querySelector("#stepper-at").textContent`)).split(" / ").map(Number);
        const [there, back] = place < count ? ["Down", "Up"] : ["Up", "Down"];
        check("↓/↑ step to the next memory in Inventory's order, and the stepper says where", count >= 2 && await (async () => { await js(`document.querySelector("#main").focus()`); await key("keyDown", there); return waitFor(`document.querySelector("#content .memory-page .ptitle")?.textContent !== ${JSON.stringify(opened)} && document.querySelector("#stepper-at").textContent === "${place < count ? place + 1 : place - 1} / ${count}"`); })(), await js(`document.querySelector("#stepper-at").textContent`));
        await key("keyDown", back);
        await waitFor(`document.querySelector("#content .memory-page .ptitle")?.textContent === ${JSON.stringify(opened)}`);
        await key("keyDown", "Escape");
        check("Escape goes back to Inventory, with the memory it showed selected", await waitFor(`document.querySelector("#title").textContent === "Inventory" && document.querySelector("#content .invrow.sel .say")?.textContent === ${JSON.stringify(opened)}`), await js(`document.querySelector("#title").textContent`));

        // APP-110: a row previews on hover and on focus. The card is read-only, stays in the window, and opens the sheet on click.
        const at = await js(`(() => { const r = document.querySelector("#content .invrow[data-key^=memory] .say").getBoundingClientRect(); return [Math.round(r.left + 24), Math.round(r.top + r.height / 2)]; })()`);
        window.webContents.sendInputEvent({ type: "mouseMove", x: at[0], y: at[1] });
        check("a preview card appears after a short hover", await waitFor(`document.querySelector(".peek")`));
        const peekText = await js(`document.querySelector(".peek")?.textContent ?? ""`);
        const rowTitle = await js(`document.querySelector("#content .invrow[data-key^=memory] .say").textContent`);
        check("the card shows title, date, and content, and offers no actions", peekText.startsWith(rowTitle) && /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+/.test(peekText) && /first ten buyers|management layer/.test(peekText) && await js(`document.querySelectorAll(".peek button").length`) === 0, peekText);
        check("the card stays inside the window", await js(`(() => { const r = document.querySelector(".peek").getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
        await shot("memory-peek");
        await key("keyDown", "Escape");
        check("Escape hides the preview", await waitFor(`document.querySelector(".peek") === null`, 8));
        window.webContents.sendInputEvent({ type: "mouseMove", x: 10, y: 10 });
        // The mouse leaving reaches the row (sendInputEvent says nothing when), so its leave can't land after the focus below.
        await sleep(200);
        // Focus is still on the row from the sheet's return, so leave it and come back as Tab would.
        await js(`document.querySelector("#main").focus(); document.querySelector("#content .invrow[data-key^=memory] .say").focus();`);
        check("keyboard focus shows the same card", await waitFor(`document.querySelector(".peek")`));
        await js(`document.querySelector(".peek").click()`);
        await waitFor(`document.querySelector("#content .memory-page")`);
        check("clicking the card opens the memory's page and drops the card", await js(`Boolean(document.querySelector("#content .memory-page")) && document.querySelector(".peek") === null`));
        await js(`document.querySelector("#main").focus()`);
        await key("keyDown", "Escape");
        await waitFor(`!document.querySelector("#content .memory-page")`, 8);

        // APP-107: ⌘K is a switcher. Typing finds a memory; typing what Lore does not have offers to capture it.
        await js(`document.querySelector("#search").focus()`);
        await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))`);
        check("⌘K opens the palette with the field focused", await js(`document.querySelector("#palette")?.open === true && document.activeElement === document.querySelector("#palette-input")`));
        check("nothing typed lists recent memories", await waitFor(`document.querySelectorAll("#palette .palette-row").length === 2`));
        await js(`{ const f = document.querySelector("#palette-input"); f.value = "management"; f.dispatchEvent(new Event("input")); }`);
        check("typing ranks the title match first and marks the match", await waitFor(`document.querySelector("#palette .palette-row")?.textContent.includes("Hire management") && document.querySelector("#palette .palette-row mark")?.textContent.toLowerCase() === "management"`));
        check("the capture row follows the matches", await js(`document.querySelector("#palette .palette-row:last-child").textContent.includes("Capture “management”")`));
        const keys = await js(`document.querySelector("#palette .palette-keys").textContent`);
        check("the footer names the three keys", /↑↓/.test(keys) && /↵ open/.test(keys) && /esc/.test(keys), keys);
        await shot("palette-match");
        await key("keyDown", "Return");
        await waitFor(`document.querySelector("#content .memory-page")`);
        check("Enter opens the selected memory's page and closes the palette", await js(`document.querySelector("#content .memory-page .ptitle")?.textContent === "Hire management before rapid growth" && !document.querySelector("#palette").open`));
        await js(`document.querySelector("#main").focus()`);
        await key("keyDown", "Escape");
        await waitFor(`!document.querySelector("#content .memory-page")`, 8);
        await js(`document.querySelector("#search").focus(); document.querySelector("#search").click();`);
        check("the sidebar field opens the same palette", await js(`document.querySelector("#palette").open === true`));
        await key("keyDown", "Escape");
        check("esc closes the palette and returns focus to where it was", await waitFor(`!document.querySelector("#palette").open && document.activeElement === document.querySelector("#search")`, 8), await js(`document.activeElement.outerHTML.slice(0, 60)`));
        await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))`);
        await js(`{ const f = document.querySelector("#palette-input"); f.value = "Something Lore has never heard"; f.dispatchEvent(new Event("input")); }`);
        check("no match puts the capture row first, selected", await waitFor(`document.querySelectorAll("#palette .palette-row").length === 1 && document.querySelector("#palette .palette-row.capture[aria-selected=true]")`));
        check("…and the footer says Enter captures", await js(`document.querySelector("#palette-enter").textContent`) === "capture");
        await shot("palette-capture");
        await key("keyDown", "Return");
        check("Enter lands on Today with the text in the composer, focused", await waitFor(`document.querySelector("#title").textContent !== "Inventory" && document.querySelector("#capture-input").value === "Something Lore has never heard" && document.activeElement === document.querySelector("#capture-input")`, 8));
        check("…with the composer showing its focus halo", await js(`(() => { const ring = getComputedStyle(document.querySelector("#composer")); return ring.outlineStyle === "none" && /0px 0px 0px 4px/.test(ring.boxShadow); })()`), await js(`getComputedStyle(document.querySelector("#composer")).boxShadow`));
        await js(`document.querySelector("#capture-input").value = ""; window.__lore.show("memories")`);
        await waitFor(`document.querySelectorAll("#content .invrow[data-key^=memory] .say").length >= 1`);
        await js(`document.querySelector("#content .invrow[data-key^=memory] .say").click()`);
        await waitFor(`document.querySelector("#content .memory-page")`);
        await js(`document.querySelector("#task-back").click()`);
        await waitFor(`document.querySelector("#content .invrow[data-key^=memory] .say")`);
        chmodSync(join(process.env.LORE_HOME, "lore.db"), 0o000);
        await js(`document.querySelector("#content .invrow[data-key^=memory] .say").click()`);
        const shown = await waitFor(`document.querySelector("#status .notice.attention")`);
        chmodSync(join(process.env.LORE_HOME, "lore.db"), 0o600);
        const err = await js(`document.querySelector("#status .notice.attention")?.textContent ?? ""`);
        check("memory open failure is visible on Memories", shown && err.length > 0, err.slice(0, 120));
        await shot("memories-error-notice");

        // Cross-view: notices stay while the owner moves around, then the same tell() lands in the log inside a thread.
        await js(`window.__lore.show("inbox")`);
        check("notice persists across views", await js(`document.querySelectorAll("#status .notice.attention").length`) === 1);
      }
    } catch (error) {
      results.push(`ERROR ${error.stack}`);
    }
    // APP-271: where the walk's time went, after its checks (edge.sh prints TIME lines with them; they never fail it).
    const seconds = (/** @type {number} */ ms) => `${(ms / 1000).toFixed(1)}s`;
    const stretches = spent.marks.map(([name, at], i) => /** @type {[string, number]} */ ([name, at - (i ? spent.marks[i - 1][1] : spent.from)])).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const timing = [
      `TIME ${scenario}: ${seconds(Date.now() - spent.from)} under Electron; ${spent.scans} layout scans took ${seconds(spent.scanning)}, pictures ${seconds(spent.picturing)}, fixed sleeps ${seconds(spent.slept)}; ${ipc.length} calls from the page`,
      `TIME ${scenario}, longest stretches before: ${stretches.map(([name, ms]) => `${seconds(ms)} ${JSON.stringify(name.slice(0, 70))}`).join("; ")}`,
      `TIME ${scenario}, waits that ran out: ${spent.gaveUp.length ? spent.gaveUp.map((at) => (/^[\d<]+$/.test(at) ? `edge.cjs:${at}` : at)).join("; ") : "none"}`
    ];
    console.log([...results, ...timing].join("\n"));
    app.exit(results.some((line) => !line.startsWith("PASS")) ? 1 : 0);
  });
});
