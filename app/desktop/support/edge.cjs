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
// The scheduler is per user, not per Lore home: point the Codex automations
// lookup at scratch so the owner's real schedule cannot answer for the seed.
if (scenario === "jobs") process.env.CODEX_HOME = join(S, "codex");
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
writeFileSync(cli.bin, `#!/bin/sh\ncd ${JSON.stringify(repo)} && exec uv run python ${JSON.stringify(join(S, "cli", "attended_cli.py"))} "$@"\n`, { mode: 0o755 });
let failSetup = scenario === "provision";
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
const relayReports = [];
// XC-036: the request form opens in the browser; record it instead.
const opened = [];
const checkoutCalls = [];
let stripeCleared = false;
let stripeChecking = false;
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
let storeElsewhere = false;
/** APP-223: whether the account signed in to hasn't verified its email, so Workers refuse the deploy. */
let emailUnverified = false;
/** @type {boolean[]} */
const storeOnlineCalls = [];
/** APP-214: every store push asked for, and how the walk ends a thread the stand-in agent left working. */
const pushes = [];
let finishThread = (/** @type {AgentTask} */ _kind) => {};
/** APP-214: the next turn fails a moment in, the way agent.mjs reports a thrown turn. */
let failNextTurn = false;
/** APP-211: every call the renderer made to the main process, every usage event it asked to record, and every write
 * remembering the automations notice. In fresh, the first of each write fails as a busy CLI's would (the usage one at
 * once, the automations one after a moment), and the third automations write is slow. */
const ipc = [];
const usage = [];
const routinesNoticed = [];
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
  const locked = () => new Error("database is locked");
  ipcMain.handle = (channel, listener) => handle(channel, (event, ...args) => {
    ipc.push(channel);
    if (failOnce.delete(channel)) return Promise.reject(new Error("the walk made this fail"));
    const waiting = held.get(channel);
    if (waiting) return waiting.then(() => listener(event, ...args));
    const answered = late.get(channel);
    if (answered) return Promise.resolve(listener(event, ...args)).then((answer) => answered.then(() => answer));
    if (scenario !== "fresh") return listener(event, ...args);
    if (channel === "usage:record") {
      usage.push(args[0]);
      if (args[0] === "noticed" && usage.filter((name) => name === "noticed").length === 1) return Promise.reject(locked());
    }
    if (channel === "routines:noticed") {
      routinesNoticed.push(Date.now());
      if (routinesNoticed.length === 1) return sleep(1500).then(() => Promise.reject(locked()));
      if (routinesNoticed.length === 3) return sleep(2000).then(() => listener(event, ...args));
    }
    return listener(event, ...args);
  });
}
if (scenario === "listing") {
  require("electron").shell.openExternal = async (url) => { opened.push(url); };
  require(join(src, "main.cjs"));
} else if (scenario === "update") {
  // APP-231: the walk's own CLI for everything but putting the store online, which records what it was asked and keeps
  // the store this Lore ships on record, as a deploy that went out does. Nothing reaches a real account.
  const bin = join(S, "update-bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "lore"), `#!/bin/sh\nif [ "$1 $2" = "node deploy" ]; then cd ${JSON.stringify(join(__dirname, "../../.."))} && uv run python -c "from lore import deploy; deploy._record_store(deploy.store_folder())"; echo "$*" >> ${JSON.stringify(join(S, "deploys"))}; echo "Deployed"; exit 0; fi\nexec ${JSON.stringify(cli.bin)} "$@"\n`, { mode: 0o755 });
  process.env.LORE_DESKTOP_BIN_DIR = bin;
  require(join(src, "main.cjs"));
} else if (scenario === "feedback") {
  const relay = require("node:http").createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => setTimeout(() => {
      relayReports.push(JSON.parse(body));
      const filed = JSON.stringify({ ok: true, issue_url: `https://github.com/dipakkrishnan/lore-mcp/issues/${relayReports.length}`, issue_number: relayReports.length });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(filed);
    }, 1500));
  });
  relay.listen(0, "127.0.0.1", () => {
    process.env.LORE_FEEDBACK_URL = `http://127.0.0.1:${relay.address().port}/report`;
    require(join(src, "main.cjs"));
  });
} else if (scenario === "sales") {
  // Records each Mac notification instead of posting it; main.cjs calls through the module, so this takes.
  require(join(src, "sales.cjs")).notify = (words, onClick) => { notes.push({ words, handlers: { click: onClick } }); };
  require(join(src, "main.cjs"));
} else if (scenario === "cards") {
  // XC-039: Lore's checkout, stubbed. One account, which Stripe clears once the owner "finishes" its form.
  require("electron").shell.openExternal = async (url) => { opened.push(url); };
  const checkout = require("node:http").createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    response.writeHead(200, { "Content-Type": "application/json" });
    if (request.method === "POST" && url.pathname === "/accounts") { checkoutCalls.push("open"); response.end(JSON.stringify({ account: "acct_1EdgeSeller", token: "a".repeat(64) })); }
    else response.end(JSON.stringify({ ready: stripeCleared, checking: stripeChecking }));
  });
  checkout.listen(0, "localhost", () => {
    process.env.LORE_CHECKOUT_URL = `http://localhost:${checkout.address().port}`;
    require(join(src, "main.cjs"));
  });
} else if (scenario === "connectors") {
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
} else if (["reading", "schedule", "checkin", "quiet", "automations"].includes(scenario)) {
  // AUT-005: everything around a reading is real except the model. The stand-in writes what a
  // reading of the two stand-in Granola meetings would, then hands it back as the agent would.
  // AUT-006 reuses it: what Lore's own schedule brings in lands the same way. AUT-008's check-in
  // stand-in answers as a model would: something worth asking about, or (quiet) nothing.
  require(join(src, "sales.cjs")).notify = (words, onClick) => { notes.push({ words, handlers: { click: onClick } }); };
  const setBadgeCount = app.setBadgeCount.bind(app);
  app.setBadgeCount = (count) => { badges.push(count); return setBadgeCount(count); };
  void import(require("node:url").pathToFileURL(join(src, "agent.mjs")).href).then(({ LoreAgent }) => {
    /** The stand-in's work still under way, as the real agent's settled() would wait for it. @type {Promise<unknown>} */
    let quiet = Promise.resolve();
    /** @param {number} ms @param {() => unknown} work */
    const later = (ms, work) => { quiet = Promise.all([quiet, new Promise((done) => setTimeout(done, ms)).then(work)]); };
    LoreAgent.prototype.settled = () => quiet.then(() => undefined);
    LoreAgent.prototype.synthesize = function (/** @type {Reading} */ reading) {
      readings.push(reading);
      readTimes.push(Date.now());
      const folder = join(process.env.LORE_HOME ?? "", "memories");
      mkdirSync(join(folder, "work"), { recursive: true });
      writeFileSync(join(folder, "first-price-after-ten-buyers.md"), "# Raise the first price only after ten buyers pay\n\nA receipt beats a survey: hold the first tier until ten buyers have paid, then raise it. From a pricing review, January 2026.\n");
      writeFileSync(join(folder, "work/ops-management-before-hiring.md"), "# Add the ops management layer before the next ten hires\n\nWork: the team's own hiring plan, from an internal ops sync.\n\nAdd the management layer before the next ten engineers join, not after.\n");
      // After the connect's own refresh, which reads tasks from disk where this stand-in keeps none.
      setTimeout(() => this.options.emit({ type: "task", task: { version: 1, kind: "synthesize", title: "Read what came in", state: "working", phase: reading.phase, updatedAt: new Date().toISOString() } }), 1500);
      later(6000, () => {
        this.options.emit({ type: "task", task: { version: 1, kind: "synthesize", title: "Read what came in", state: "done", phase: "Finished", updatedAt: new Date().toISOString() } });
        return this.options.memoriesReady?.(reading, {
          read: reading.added,
          memories: [
            { file: "first-price-after-ten-buyers.md", worth_selling: true, why: "a measured pricing rule" },
            { file: "work/ops-management-before-hiring.md", worth_selling: true, why: "names the team's plan" }
          ]
        });
      });
    };
    LoreAgent.prototype.checkIn = function (/** @type {CheckInJob} */ job) {
      checkIns.push(job);
      const [item] = job.items;
      const question = checkIns.length === 1 ? "You held the price on the Acme call. What made you hold firm?" : "What made you walk away from the Globex renewal?";
      const verdict = scenario === "quiet"
        ? { reach_out: false, why: "nothing the library doesn't already explain", questions: [] }
        : { reach_out: true, why: "a decision with no reason given", questions: [{ question, memory: item.id }] };
      later(7000, () => this.options.checkedIn?.(job, verdict));
    };
    require(join(src, "main.cjs"));
  });
} else if (scenario === "today") {
  // APP-214: every next step is clicked for real; what it reaches is recorded instead of run. A push succeeds without a
  // store, and a turn is the prompt it was sent, its thread working until the walk finishes it.
  const { ipcMain } = require("electron");
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => handle(channel, channel === "store:push" ? async () => { pushes.push(Date.now()); } : listener);
  void import(require("node:url").pathToFileURL(join(src, "agent.mjs")).href).then(({ LoreAgent }) => {
    /** @type {Map<string, TaskRecord>} */
    const threads = new Map();
    LoreAgent.prototype.tasks = () => [...threads.values()];
    LoreAgent.prototype.prompt = async function (/** @type {string} */ text, /** @type {AgentTask} */ task) {
      prompts.push({ text, task });
      const record = { version: 1, kind: task, title: { deploy: "Open your store", publish: "Publish from your Lore" }[task] ?? task, state: "working", phase: "Working", updatedAt: new Date().toISOString() };
      threads.set(task, record);
      this.options.emit({ type: "task", task: record });
      if (failNextTurn) {
        failNextTurn = false;
        this.options.emit({ type: "working", active: true, task });
        await new Promise((done) => setTimeout(done, 3000));
        const stopped = { ...record, state: "stopped", phase: "Needs another try", updatedAt: new Date().toISOString() };
        threads.set(task, stopped);
        this.options.emit({ type: "task", task: stopped });
        this.options.emit({ type: "working", active: false, task });
        throw new Error("the model stopped answering");
      }
      finishThread = (/** @type {AgentTask} */ kind) => {
        const done = { ...threads.get(kind), state: "done", phase: "Finished", updatedAt: new Date().toISOString() };
        threads.set(kind, done);
        this.options.emit({ type: "task", task: done });
      };
    };
    require(join(src, "main.cjs"));
  });
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
    execFileSync("uv", ["run", "python", "-c", `import time\nfrom lore.store import Store\nwith Store() as s:\n s.set_setting('node_url', '${url}')\n s.set_setting('node_selling', False)\n s.set_setting('node_live', {'url': '${url}', 'checked_at': time.time() + 3600, 'live': {'state': 'online', 'network': None, 'price_usd': None, 'payout': None}, 'ids': []})`], { cwd: repo, env: process.env });
  };
  // APP-215: the first-run chat's store goes online through the app, signing in to Cloudflare first when it must; both
  // stood in for, so nothing reaches a real account.
  const state = require(join(src, "state.cjs"));
  state.storeOnline = async () => {
    storeOnlineCalls.push(signedInToCloudflare);
    if (!signedInToCloudflare) return "The deploy did not finish: not signed in to Cloudflare; sign in first, then rerun.";
    if (storeElsewhere) return "The deploy did not finish: a lore-publications database already exists on this Cloudflare account, but this installation has never deployed a node before.";
    if (emailUnverified) return "The deploy did not finish: Cloudflare needs you to verify your email first. Check your inbox for their email, click the link, then tap Set it up again..";
    standInDeploy();
    return "The store is deployed.\nYour store is online for your agents. Nothing for sale yet.";
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
      setTimeout(() => void readingHeld.then(() => this.options.memoriesReady?.(reading, { read: reading.added, memories: [{ file, worth_selling: true, why: "a pricing rule from real placements" }] })).then(() => { readingsLanded++; }), 1500);
    };
    require(join(src, "main.cjs"));
  });
} else {
  require(join(src, "main.cjs"));
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const results = [];
function check(name, ok, detail = "") { results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); }
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
  const ONE_LINE = ".btn, button.choice, .chip, .status-pill, .pill, .shelf, .shelf-count, nav button, h1, h2, h3, legend, .eyebrow, .t b, .update, .search span, .form-label, .form-value, .new-mark, .routine-act, .agent-link-word, .account-trigger b, .account-menu button, .palette-keys span, .back, kbd, .agent-wait, .quiet-hint";
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
  const stuck = (bar) => {
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
/** APP-218: the walks that show the main tabs are checked again at a narrower window. */
const NARROW = new Set(["today", "store", "connectors", "automations", "settings", "firstrun", "agents"]);
const NARROW_WIDTH = 900;
/** The page's background token, light or dark. */
const BG = `getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()`;
const LIGHT_BG = "#f7f3ea";
const DARK_BG = "#141613";
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
  const todayShown = `Boolean(snapshot) && view === "today" && !detailTask && document.querySelector("#content").childElementCount > 0`;
  /** APP-218: every picture is checked for broken text first, at the window's size and, in the walks that show the
   * main tabs, at a narrower one too. @param {string} name */
  const shot = async (name) => {
    const layout = async (where) => {
      await js(SETTLE);
      const found = await js(LAYOUT);
      check(`the text sits right in ${where}`, !found.length, found.join(" | "));
    };
    await layout(name);
    writeFileSync(join(S, `${name}.png`), (await window.webContents.capturePage()).toPNG());
    if (!NARROW.has(scenario)) return;
    const { debugger: devtools } = window.webContents;
    if (!devtools.isAttached()) devtools.attach();
    await devtools.sendCommand("Emulation.setDeviceMetricsOverride", { width: NARROW_WIDTH, height: window.getContentSize()[1], deviceScaleFactor: 0, mobile: false });
    await sleep(150);
    await layout(`${name}, ${NARROW_WIDTH}px wide`);
    writeFileSync(join(S, `${name}-narrow.png`), (await window.webContents.capturePage()).toPNG());
    await devtools.sendCommand("Emulation.clearDeviceMetricsOverride");
    await sleep(100);
  };
  /** APP-222: the walk says whether motion is reduced, never the Mac running it: CI's runner has Reduce motion on, which
   * would leave every shimmer and ink-in standing still. @param {boolean} reduce */
  const motion = (reduce) => window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduce ? "reduce" : "no-preference" }] });
  /** Whether a node has a running animation of that name. @param {string} node @param {string} name */
  const animating = (node, name) => `(${node})?.getAnimations().some((a) => a.animationName === ${JSON.stringify(name)} && a.playState === "running") === true`;
  const waitFor = async (code, tries = 40) => { for (let i = 0; i < tries; i++) { if (await js(code)) return true; await sleep(250); } return false; };
  const key = async (type, keyCode) => { window.webContents.sendInputEvent({ type, keyCode }); await sleep(30); };

  window.webContents.once("did-finish-load", async () => {
    try {
      // Focus events need a focused page, which a window launched in the background never is.
      window.webContents.debugger.attach();
      await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await motion(false);
      // APP-218: a window behind others still paints frames, so every screenshot waits on real ones.
      window.webContents.setBackgroundThrottling(false);
      await sleep(1500);
      check(`the window is drawn ${DARK ? "dark" : "light"}, as kept`, nativeTheme.shouldUseDarkColors === DARK && (await js(BG)) === (DARK ? DARK_BG : LIGHT_BG), await js(BG));
      if (scenario === "provision") {
        // Fix 4: setup failed. Every button must answer, the banner must say so, and Try again must recover.
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
      } else if (scenario === "jobs") {
        // APP-007: owner-run history survives the live event that produced it,
        // so Automations must render every state it can be in — including a run
        // that started and never reported finishing. APP-214: it lives there, not on Today.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        check("Today carries no Activity", !(await js(`document.querySelector("#content").textContent.includes("Activity")`)));
        await js(`window.__lore.show("automations")`);
        check("Automations carries no run log, only automations", await waitFor(`document.querySelector("#content .automations") !== null`) && !(await js(`/Recent runs|Activity/.test(document.querySelector("#content").textContent)`)));
        await js(`window.__lore.show("settings")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Activity")`);
        check("Activity is Settings' last section", await js(`document.querySelector("#content").lastElementChild.querySelector("h2")?.textContent === "Activity"`));
        const runs = await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Activity")).textContent`);
        check("a finished capture reads as done, and never says what the agent cost", /Capture/.test(runs) && /Saved what you approved/.test(runs) && !/\$/.test(runs), runs);
        check("a failed push says so", /Store update/.test(runs) && /Failed/.test(runs), runs);
        check("a finished push says how big the store is and what changed", /19 publications on your store, 2 more than before/.test(runs), runs);
        check("a run that never reported is unfinished, not successful", /Synthesis/.test(runs) && /Unfinished/.test(runs) && /never reported/.test(runs), runs);
        check("a run still going reads as running", /Store deploy/.test(runs) && /Running/.test(runs), runs);
        check("each run's state is a dot and a word, not a chip", await js(`(() => { const box = [...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Activity")); return !box.querySelector(".chip") && box.querySelectorAll(".run-state .dot").length === box.querySelectorAll(".row").length; })()`));
        // The failure cause names wrangler and a database to the owner, but
        // none of it is durable — history keeps a bounded phrase.
        check("history carries no command or path", !/wrangler|npx|\/Users\//.test(runs), runs);
        await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Activity")).scrollIntoView()`);
        await sleep(300);
        await shot("settings-activity");
        // A run with a thread behind it opens that thread from Settings, on Today, as it did from Today.
        await js(`[...document.querySelectorAll("#content .task-link")].find((b) => b.textContent.includes("Store deploy")).click()`);
        check("an Activity row opens its thread, saying the run is still going", await waitFor(`document.querySelector("#title").textContent === "Store deploy" && document.querySelector("#eyebrow").textContent === "Working · Running" && !document.querySelector("#task-back").hidden`), `${await js(`document.querySelector("#title").textContent`)} | ${await js(`document.querySelector("#eyebrow").textContent`)}`);
        await js(`document.querySelector("#task-back").click()`);

        // The record is read from the snapshot, not from agent memory, so it is
        // still here after a relaunch — which is the whole point of the table.
        await js(`window.__lore.show("memories")`);
        await sleep(300);
        await js(`window.__lore.show("settings")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Activity")`);
        check("history survives leaving and returning", await js(`document.querySelector("#content").textContent.includes("Saved what you approved")`));

        // An owner who has run nothing yet gets a sentence, not a bare heading.
        execFileSync("uv", ["run", "python", "-c", "from lore.store import Store\nwith Store() as s:\n s.db.execute('DELETE FROM owner_jobs')\n s.db.commit()"], { cwd: join(__dirname, "../../.."), env: process.env });
        // A "changed" event is what makes the renderer re-read the snapshot;
        // switching views alone re-renders what it already had.
        await js(`window.__lore.event({ type: "changed" })`);
        // The re-read runs the CLI several times; on a busy Mac it takes longer than any fixed pause.
        check("an owner with no runs yet sees no Activity section", await waitFor(`![...document.querySelectorAll("#content .section")].some((s) => s.textContent.includes("Activity"))`));
        check("the rest of Settings still renders", await js(`document.querySelector("#content").textContent.includes("Account")`));
        await shot("settings-activity-empty");

        // AUT-010: a reading Codex ran, every Sunday at 9 PM, is Lore's from the first launch, with no agent named.
        await js(`window.__lore.show("connectors")`);
        const rhythm = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How often Lore reads them"))?.textContent ?? ""`;
        check("a reading Codex ran is Lore's now, on the owner's day and hour", await waitFor(`/Every Sunday at 9 PM, while Lore is open\\. Hasn't run yet\\./.test(${rhythm})`) && !/Codex|Claude/.test(await js(rhythm)), await js(rhythm));
        await shot("settings-taken-over");
        await js(`window.__lore.show("automations")`);
        const reading = `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector("b")?.textContent === "Read connected apps")?.textContent ?? ""`;
        check("…and Automations lists it like any other, with Run now", await waitFor(`(${reading}).includes("Every Sunday at 9 PM")`) && await js(`window.lore.routines().then((all) => all.find((r) => r.id === "synthesis")?.next_run === [...document.querySelectorAll("#content .row")].find((r) => r.querySelector("b")?.textContent === "Read connected apps")?.querySelector("[data-next]")?.dataset.next)`) && !/Codex|Claude| by /.test(await js(reading)) && await js(`Boolean(document.querySelector("#content .routine-act[aria-label='Run now']"))`), await js(reading));
        await shot("automations-taken-over");
      } else if (scenario === "update") {
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        const nextStep = `(document.querySelector("#content .next-step")?.textContent ?? "")`;
        const changes = `document.querySelector("dialog.changes-sheet[open]")`;
        const answerChanges = (/** @type {string} */ label) => js(`[...${changes}.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        const address = `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector(".t b")?.textContent === "Address")`;
        const update = () => js(`[...${address}.querySelectorAll("button")].find((b) => b.textContent === "Update").click()`);
        const deploys = () => (existsSync(join(S, "deploys")) ? readFileSync(join(S, "deploys"), "utf8").trim().split("\n") : []);
        const older = () => writeFileSync(join(process.env.LORE_STORE ?? "", "deployed.json"), JSON.stringify({ store: "an older one" }));
        const settled = async () => { await js(`window.__lore.event({ type: "changed" })`); await sleep(1500); };
        // APP-231: a newer store from Lore is never a step on Today.
        await waitFor(`window.lore.snapshot().then((s) => s.node.store === "outdated")`, 80);
        await sleep(800);
        check("a newer store from Lore is not a step on Today", !/newer store|store has an update|update from Lore/i.test(await js(`document.querySelector("#content").textContent`)), await js(nextStep));
        // It is offered quietly where the store shows: Settings, and the store card.
        await js(`window.__lore.show("settings")`);
        check("Settings says a newer store is ready beside the store's address, with a quiet Update", await waitFor(`${address}?.textContent.includes("Your store has an update.") && [...${address}.querySelectorAll("button")].some((b) => b.textContent === "Update" && b.classList.contains("quiet"))`, 80), await js(`${address}?.textContent ?? ""`));
        check("…never naming code, versions or deploys", !/worker|code|version|deploy/i.test(await js(`${address}.textContent`)), await js(`${address}.textContent`));
        await shot("update-settings");
        await js(`window.__lore.show("store")`);
        check("the store card offers the same quiet Update", await waitFor(`[...document.querySelectorAll("#content .store-bar button")].some((b) => b.textContent === "Update") && document.querySelector("#content .store-bar").textContent.includes("Your store has an update.")`, 40), await js(`document.querySelector("#content .store-bar")?.textContent ?? ""`));
        await shot("update-store-card");
        await js(`window.__lore.show("settings")`);
        await waitFor(address);
        await update();
        check("Update asks first, naming the newer store on the card", await waitFor(`${changes}?.textContent.includes("Store") && ${changes}.textContent.includes("The latest from Lore")`), await js(`${changes}?.textContent ?? ""`));
        await shot("update-confirm");
        await answerChanges("Cancel");
        await waitFor(`!document.querySelector("dialog.changes-sheet[open]")`);
        check("Cancel puts nothing out, and the Update stays on offer", deploys().length === 0 && await waitFor(`${address}?.textContent.includes("Your store has an update.")`), deploys().join("|"));
        await update();
        await waitFor(changes);
        await answerChanges("Confirm");
        for (let i = 0; i < 120 && deploys().length < 1; i++) await sleep(250);
        check("Confirm puts the store out again as it was last opened: its network and payout", deploys().at(-1) === `node deploy --network test --wallet 0x${"a".repeat(40)}`, deploys().join("|"));
        check("…and once it is the store this Lore ships, nothing more is offered", await waitFor(`window.lore.snapshot().then((s) => s.node.store === "current")`, 80) && await waitFor(`!${address}?.textContent.includes("A newer store")`, 40), await js(`${address}?.textContent ?? ""`));
        // A store online only for its agents goes out the same way it was put online.
        execFileSync("uv", ["run", "python", "-c", "from lore.store import Store\nwith Store() as s:\n s.set_setting('node_selling', False)"], { cwd: join(__dirname, "../../.."), env: process.env });
        older();
        await settled();
        check("a store online only for its agents is offered its update too", await waitFor(`${address}?.textContent.includes("Your store has an update.")`, 80), await js(`${address}?.textContent ?? ""`));
        await update();
        await waitFor(changes);
        await answerChanges("Confirm");
        for (let i = 0; i < 120 && deploys().length < 2; i++) await sleep(250);
        check("…and goes out online for its agents only", deploys().at(-1) === "node deploy --inbox-only", deploys().join("|"));
        // With no record of putting it online from this Mac, it might be another Mac's store: never offered.
        rmSync(join(process.env.LORE_STORE ?? "", "deployed.json"), { force: true });
        rmSync(join(process.env.LORE_STORE ?? "", "payout.json"), { force: true });
        await settled();
        check("a store this Mac has no record of putting online is never offered an update", await waitFor(`window.lore.snapshot().then((s) => s.node.store === "unknown")`, 80) && !(await js(`${address}?.textContent ?? ""`)).includes("A newer store"), await js(`${address}?.textContent ?? ""`));
      } else if (scenario === "store") {
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Approve what to sell")`);
        // Fix 4: with a store open, Settings offers a way back into the deploy conversation.
        await js(`window.__lore.show("settings")`);
        await sleep(600);
        const settings = await js(`document.querySelector("#content").textContent`);
        check("Settings offers to set the price once a store exists", await js(`[...document.querySelectorAll("#content button")].some((b) => /^(Set a price|Change)$/.test(b.textContent))`));
        // Ledger: the payout address links to Basescan on the live network, on Settings and on the For Sale bar.
        check("Settings shows the payout address", settings.includes("0xaaaa…aaaa"));
        check("…linked to the address on Sepolia Basescan", await js(`[...document.querySelectorAll("#content a.link-btn")].some((a) => a.textContent === "View ↗" && a.href === "https://sepolia.basescan.org/address/0x${"a".repeat(40)}")`));
        check("Settings offers the switch to real payments while on the test network", settings.includes("Switch to real payments"));
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await sleep(200);
        await shot("settings-store");
        // APP-019: one editor on For Sale; a saved price the node does not charge yet is standing state on For Sale and Today.
        await js(`[...document.querySelectorAll("#content button")].find((b) => /^(Set a price|Change)$/.test(b.textContent)).click()`);
        const priceInput = `document.querySelector("dialog.form-sheet[open] input[aria-label='Price per publication in US dollars']")`;
        await waitFor(priceInput);
        check("Settings' Change price lands on Inventory with the price sheet open on its field", await js(`document.querySelector("#title").textContent === "Inventory" && document.querySelector("dialog.form-sheet[open]")?.getAttribute("aria-label") === "Price" && document.activeElement === ${priceInput}`));
        await js(`{ const field = ${priceInput}; field.value = "0"; field.form.requestSubmit(); }`);
        await sleep(300);
        check("zero is refused in the sheet, which stays open", await js(`document.querySelector("dialog.form-sheet[open] .problem")?.textContent.includes("above zero") && Boolean(${priceInput})`));
        await js(`{ const field = ${priceInput}; field.value = "0.75"; field.form.requestSubmit(); }`);
        check("a saved price closes the sheet", await waitFor(`!document.querySelector("dialog.form-sheet[open]:not(.changes-sheet)")`));
        // APP-226: what an update puts out waits on the owner's Confirm, piece by piece and term by term.
        const changes = `document.querySelector("dialog.changes-sheet[open]")`;
        const answerChanges = (/** @type {string} */ label) => js(`[...${changes}.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        check("the store charges a new price only once the owner confirms it", await waitFor(`${changes}?.textContent.includes("$0.02 a piece → $0.75 a piece")`), await js(`${changes}?.textContent ?? ""`));
        await answerChanges("Cancel");
        await waitFor(`!document.querySelector("dialog.changes-sheet[open]")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Your store still charges $0.02.")`);
        check("a saved price the node does not charge yet says so on For Sale", await js(`document.querySelector("#content .store-bar").textContent.includes("$0.75") && document.querySelector("#content .store-bar").textContent.includes("Your store still charges $0.02.")`));
        const salesBox = await js(`[...document.querySelectorAll("#content section")].find((n) => n.querySelector("h2")?.textContent === "Sales")?.textContent ?? ""`);
        check("a store not opened on this Mac says so about sales, in plain words", salesBox.includes("Sales show here once your store is open on this Mac.") && !/deployed|node|machine/.test(salesBox), salesBox);
        check("…with exactly one Update store control on the card", await js(`[...document.querySelectorAll("#content .store-bar button, #content .store-bar a")].filter((b) => b.textContent === "Update store").length === 1`));
        await shot("store-stale-price");
        await js(`window.__lore.show("today")`);
        await sleep(400);
        const nextStep = `(document.querySelector("#content .next-step")?.textContent ?? "")`;
        check("Today's next step is the update, in plain words", await js(`${nextStep}.includes("1 change isn't live yetYour store still charges $0.02, not $0.75Update store")`), await js(nextStep));
        // Fix 5: approved work the node does not hold yet gets a standing Push, on For Sale and as Today's next step.
        await js(`window.__lore.show("today")`);
        await sleep(400);
        const pushJobs = `window.lore.snapshot().then((s) => (s.jobs?.items ?? []).filter((j) => j.kind === "push").length)`;
        const pushedBefore = await js(pushJobs);
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Approve").click()`);
        await waitFor(`document.querySelector("#content").textContent.includes("approved, not on your store yet")`);
        check("an approval with another draft still waiting puts nothing out yet", !(await js(changes)) && await js(pushJobs) === pushedBefore);
        await js(`[...document.querySelectorAll("#content .next-step button")].find((b) => b.textContent === "Update store").click()`);
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
        check("the Sales section sums the ledger", store.includes("2 sales · $0.02 · last Sep 2"), store.slice(-200));
        check("each sale links to its transaction, as a Receipt", await js(`[...document.querySelectorAll("#content a.receipt")].map((a) => a.href).join(" ")`) === "https://sepolia.basescan.org/tx/0xfeed https://sepolia.basescan.org/tx/0xbeef");
        check("no hash is spelled out in the row", !store.includes("0xfeed"));
        check("the approved publication counts its sales", store.includes("1 sold"));
        check("the For Sale bar links to payouts, as a quiet link", await js(`[...document.querySelectorAll("#content .store-bar a.quiet-link")].some((a) => a.textContent === "Payouts ↗") && !document.querySelector("#content .store-bar a.link-btn")`));
        // APP-211: one calm row in the UI font: Live and the host on the left, the prices on the right.
        check("the store card has no monospace", await js(`[...document.querySelectorAll("#content .store-bar *")].every((n) => !getComputedStyle(n).fontFamily.includes("Mono"))`), await js(`[...document.querySelectorAll("#content .store-bar *")].map((n) => getComputedStyle(n).fontFamily).find((f) => f.includes("Mono")) ?? ""`));
        check("…titled Live, with the host under it", await js(`document.querySelector("#content .store-bar .t b").textContent === "Live · Test mode" && document.querySelector("#content .store-bar .host").textContent === "store.example"`));
        check("…and the price by the piece, with its free copies", await js(`document.querySelector("#content .store-bar .price-row").textContent`) === "$0.75 a piece · first 3 copies free", await js(`document.querySelector("#content .store-bar .price-row").textContent`));
        await shot("store-sales");
        check("For Sale bar offers Update store while an approved item is not live", await js(`[...document.querySelectorAll("#content .store-bar button")].some((b) => b.textContent === "Update store")`));
        check("the one item not on the store says so on its row, once", await js(`(document.querySelector("#content").textContent.match(/Not on your store yet/g) ?? []).length === 1 && !document.querySelector("#content").textContent.includes("Not live yet")`));
        await shot("store-unpushed");
        await js(`window.__lore.show("today")`);
        await sleep(400);
        check("Today's next step carries the standing Push", await js(`${nextStep}.includes("1 approved, not on your store yet")`), await js(nextStep));
        // APP-093: a take-down the node has not absorbed yet is pending state read from the snapshot, not a banner.
        // The fake wrangler makes the revoke's push "succeed", which drops the probe cache; re-seed it as a node that still lists the item.
        await js(`window.__lore.show("store")`);
        await waitFor(`document.querySelector("#content").textContent.includes("2 sales")`);
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Take down").click()`);
        await sleep(200);
        check("take-down confirmation does not promise buyers lose their copies", await js(`document.querySelector("#content").textContent.includes("Anyone who already did keeps their copy.")`));
        await js(`[...document.querySelectorAll("#content button.primary")].find((b) => b.textContent === "Take down").click()`);
        // The update that takes it down also carries the new price, so the owner confirms that first.
        check("a take-down that also puts out a new price asks about the price", await waitFor(`${changes}?.textContent.includes("$0.02 a piece → $0.75 a piece")`), await js(`${changes}?.textContent ?? ""`));
        await answerChanges("Confirm");
        await waitFor(`document.querySelector("#content").textContent.includes("Taken down")`);
        // This scratch home has no node source, so the revoke's push fails: the owner hears that plainly, not as a command.
        const revokeNotice = await js(`document.querySelector("#status").textContent`);
        check("a take-down whose push failed reads plainly", revokeNotice.includes("Your store stops selling it as soon as it updates.") && !/wrangler|--worker-dir|\/Users\/|\/var\//.test(revokeNotice), revokeNotice);
        execFileSync("uv", ["run", "python", "-c", `import time\nfrom lore.store import Store\nwith Store() as s:\n s.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:84532', 'payout': '0x' + 'a' * 40}, 'ids': ['${publicId}']})`], { cwd: join(__dirname, "../../.."), env: process.env });
        await js(`window.__lore.event({ type: "changed" })`);
        await waitFor(`[...document.querySelectorAll(".shelf")].some((t) => t.textContent.startsWith("Taken down"))`);
        await js(`[...document.querySelectorAll(".shelf")].find((t) => t.textContent.startsWith("Taken down")).click()`);
        check("a taken-down item the node still serves says so, under Taken down", await waitFor(`document.querySelector("#content").textContent.includes("Still on your store")`));
        check("…and For Sale offers the update that removes it", await js(`[...document.querySelectorAll("#content .store-bar button")].some((b) => b.textContent === "Update store")`));
        await shot("store-removal-pending");
        await js(`window.__lore.show("today")`);
        await sleep(400);
        check("Today's next step names the pending removal", await js(`${nextStep}.includes("1 taken down, still on your store")`), await js(nextStep));
        // APP-211: the last piece taken down, its removal not on the store yet, and a new price: Update store pushes the removal first.
        const pendingRemoval = () => execFileSync("uv", ["run", "python", "-c", `import time\nfrom lore.store import Store\nwith Store() as s:\n s.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:84532', 'price_usd': 0.02, 'payout': '0x' + 'a' * 40}, 'ids': ['${publicId}']})`], { cwd: join(__dirname, "../../.."), env: process.env });
        pendingRemoval();
        await js(`window.__lore.event({ type: "changed" })`);
        check("Today's next step counts both changes: the removal still pending and the new price", await waitFor(`snapshot.node.live.price_usd === 0.02 && ${nextStep}.includes("2 changes aren't live yet") && ${nextStep}.includes("1 taken down, still on your store")`), await js(nextStep));
        const todayUpdates = `[...document.querySelectorAll("#content button")].filter((b) => b.textContent === "Update store")`;
        check("Today offers one Update store for it", await js(`${todayUpdates}.length === 1`), String(await js(`${todayUpdates}.length`)));
        let before = ipc.length;
        await js(`${todayUpdates}[0].click()`);
        for (let i = 0; i < 40 && !ipc.slice(before).includes("store:push"); i++) await sleep(100);
        check("…which pushes, and starts no deploy", ipc.slice(before).includes("store:push") && !ipc.slice(before).includes("agent:prompt"), JSON.stringify(ipc.slice(before)));
        check("…once the owner confirms the piece coming off and the new price", await waitFor(`${changes}?.textContent.includes("Coming off") && ${changes}.textContent.includes("Hire management before rapid growth") && ${changes}.textContent.includes("$0.02 a piece → $0.75 a piece")`), await js(`${changes}?.textContent ?? ""`));
        await answerChanges("Confirm");
        await waitFor(`!document.querySelector("dialog.changes-sheet[open]")`);
        pendingRemoval();
        await js(`window.__lore.event({ type: "changed" })`);
        await js(`window.__lore.show("store")`);
        await waitFor(`document.querySelector("#content .store-bar").textContent.includes("Your store still charges $0.02.")`);
        const updates = `[...document.querySelectorAll("#content .store-bar button, #content .store-bar a")].filter((b) => /^(Update store|Updating…)$/.test(b.textContent))`;
        check("a pending removal and a new price: one Update store", await js(`${updates}.length === 1`), String(await js(`${updates}.length`)));
        before = ipc.length;
        await js(`${updates}[0].click()`);
        for (let i = 0; i < 40 && !ipc.slice(before).includes("store:push"); i++) await sleep(100);
        check("…which pushes the removal first, not a redeploy", ipc.slice(before).includes("store:push") && !ipc.slice(before).includes("agent:prompt") && await js(`document.querySelector("#title").textContent`) === "Inventory", JSON.stringify(ipc.slice(before)));
        await waitFor(changes);
        await answerChanges("Confirm");
        check("…and goes out on Confirm", await waitFor(`!document.querySelector("dialog.changes-sheet[open]")`));
        await shot("store-push-first");
        // Fix 9: a memory typed on Today joins the unfinished capture thread instead of an empty one.
        await js(`window.__lore.show("today")`);
        await js(`window.__lore.event({ type: "task", task: { version: 1, kind: "capture", title: "Capture", state: "stopped", phase: "Reply to keep going", updatedAt: new Date().toISOString() } })`);
        await sleep(300);
        check("unfinished capture is listed", await js(`document.querySelector("#content").textContent.includes("Reply to keep going")`));
        check("an unfinished thread is one row to open, waiting for the owner, with no Resume", await js(`(() => { const row = [...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Reply to keep going")); return Boolean(row) && row.textContent.includes("Waiting for you") && !row.querySelector(".btn"); })()`));
        await js(`const i = document.querySelector("#capture-input"); i.value = "Something I learned"; document.querySelector("#composer").requestSubmit();`);
        await sleep(800);
        const eyebrow = await js(`document.querySelector("#eyebrow").textContent`);
        check("root capture joins the unfinished thread", /Reply to keep going/.test(eyebrow), eyebrow);
        await shot("root-capture-joined");
        await js(`window.__lore.openTask("deploy")`);
        const deployLog = await js(`document.querySelector("#log").textContent`);
        check("a completed deploy opens with fresh history", !deployLog.includes("OLD COMPLETED DEPLOY"), deployLog);
        check("drafts stay out of a thread that cannot draft", !(await js(`[...document.querySelectorAll("#main h2")].some((h) => h.textContent === "Approve what to sell")`)));
      } else if (scenario === "fresh") {
        // APP-109: an empty Lore names the next action and carries the control that takes it.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        // APP-211: signing out before the first load lands leaves nothing remembered and nothing sent.
        await js(`window.__lore.signIn(); auth = { credentials: [] }; enter(); true`);
        await sleep(2500);
        check("signing out while Lore loads remembers nothing and sends nothing", usage.length === 0 && await js(`document.body.dataset.state === "welcome" && !document.querySelector("#status .notice")`) && await js(`window.lore.snapshot().then((s) => s.setup.telemetry_noticed !== true && s.setup.automations_noticed === false)`), JSON.stringify(usage));
        // APP-211: the owner is on another page when Lore loads. Today's notices wait for Today, and aren't remembered as said until seen.
        await js(`window.__lore.show("connectors")`);
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#title").textContent === "Connectors" && document.querySelector("#content section")`);
        await sleep(1500);
        check("loading on another page shows no notice there", await js(`!document.querySelector("#status .notice")`), await js(`document.querySelector("#status").textContent`));
        check("…and nothing is remembered as said before it's seen", usage.length === 0 && await js(`window.lore.snapshot().then((s) => s.setup.telemetry_noticed !== true && s.setup.automations_noticed === false)`), JSON.stringify(usage));
        await js(`window.__lore.show("today")`);
        await waitFor(todayShown);
        // AUT-009: with no profile, Lore's own routines are on from the start; with nothing connected, there is nothing to say about them yet.
        check("the first visit to Today tells about usage events", await waitFor(`document.querySelector("#status").textContent.includes("anonymous usage events")`));
        // The first write to remember it fails; the next snapshot tries again, with the notice still shown once.
        for (let i = 0; i < 40 && !usage.length; i++) await sleep(100);
        await sleep(500);
        check("…and tries to remember it only then; that first write fails and nothing else is sent", JSON.stringify(usage) === JSON.stringify(["noticed"]) && await js(`window.lore.snapshot().then((s) => s.setup.telemetry_noticed !== true)`), JSON.stringify(usage));
        await js(`window.__lore.event({ type: "changed" })`);
        check("…a later snapshot remembers it", await waitFor(`window.lore.snapshot().then((s) => s.setup.telemetry_noticed === true)`), JSON.stringify(usage));
        for (let i = 0; i < 40 && !usage.includes("app.opened"); i++) await sleep(100);
        check("…and only then counts Lore as opened", JSON.stringify(usage) === JSON.stringify(["noticed", "noticed", "app.opened"]), JSON.stringify(usage));
        check("…with the notice shown once throughout", await js(`[...document.querySelectorAll("#status .notice")].filter((n) => n.textContent.includes("anonymous usage events")).length === 1`));
        check("…and says nothing about reading connected apps while none is connected", !(await js(`document.querySelector("#status").textContent`)).includes("connected apps") && await js(`window.lore.snapshot().then((s) => s.setup.automations_noticed === false)`), await js(`document.querySelector("#status").textContent`));
        await shot("today-usage-notice");
        // APP-211: notices belong to Today; the other pages open clean.
        for (const page of ["inventory", "connectors", "automations"]) {
          await js(`window.__lore.show(${JSON.stringify(page)})`);
          await sleep(300);
          check(`${page} carries no notice`, await js(`!document.querySelector("#status .notice")`), await js(`document.querySelector("#status").textContent`));
        }
        await shot("automations-no-notice");
        await js(`window.__lore.show("today")`);
        check("…and back on Today the usage notice is still there until dismissed", await waitFor(`document.querySelector("#status").textContent.includes("anonymous usage events")`));
        await js(`window.__lore.show("automations")`);
        await sleep(500);
        check("Automations shows every one of Lore's own on", await js(`document.querySelector("#title").textContent`) === "Automations" && await js(`[...document.querySelectorAll("#content .switch")].map((s) => s.getAttribute("aria-label") + "=" + s.getAttribute("aria-checked")).join("|")`) === "Pause Read connected apps=true|Pause Evening check-in=true|Pause Suggest collections=true", await js(`document.querySelector("#content").textContent`));
        await shot("automations-on-by-default");
        await js(`window.__lore.show("memories")`);
        await sleep(400);
        const memories = await js(`document.querySelector("#content .empty")?.textContent ?? ""`);
        check("empty Inventory says what to do and offers to do it", memories.startsWith("Nothing kept yet. Say what you learned, or connect an agent, and Lore will keep it.") && await js(`document.querySelector("#content .empty button")?.textContent`) === "Add your first memory", memories);
        await shot("memories-empty");
        await js(`document.querySelector("#content .empty button").click()`);
        await sleep(300);
        check("Add your first memory lands on Today with the composer focused", await js(`document.querySelector("#title").textContent !== "Inventory" && document.activeElement === document.querySelector("#capture-input")`));
        await js(`window.__lore.show("store")`);
        await sleep(600);
        check("no store: the bar offers to open one", await js(`[...document.querySelectorAll("#content .store-bar button")].some((b) => b.textContent === "Open your store")`));
        check("…and shows no price it doesn't have", !(await js(`document.querySelector("#content .store-bar").textContent`)).includes("Not set"), await js(`document.querySelector("#content .store-bar").textContent`));
        const forSale = await js(`[...document.querySelectorAll("#content .empty")].map((n) => n.textContent).join("|")`);
        check("nothing on sale: one sentence and a way to what's private", /Nothing on sale yet\./.test(forSale) && await js(`[...document.querySelectorAll("#content .empty button")].some((b) => b.textContent === "See what's private")`), forSale);
        check("no sales: left alone, no action", await js(`[...document.querySelectorAll("#content .empty")].find((n) => n.textContent.includes("No sales yet")).querySelector("button") === null`));
        check("every empty-state action is a real button, reachable by keyboard", await js(`[...document.querySelectorAll("#content .empty button, #content .store-bar button")].every((b) => b.tabIndex >= 0)`));
        await shot("store-empty");
        await js(`[...document.querySelectorAll("#content .empty button")].find((b) => b.textContent === "See what's private").click()`);
        await sleep(300);
        check("See what's private opens Inventory's Private tab", await js(`document.querySelector(".shelf[aria-selected=true]")?.textContent.startsWith("Private")`));
        // Opened again: a new page on the same Lore home.
        const reloaded = new Promise((done) => window.webContents.once("did-finish-load", done));
        window.webContents.reload();
        await reloaded;
        // The page's own sign-in check answers first, as on the first launch; signing in before it would be undone by it.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        await sleep(1500);
        check("opened again, it says nothing more about it", !/Change this in Automations|anonymous usage events/.test(await js(`document.querySelector("#status").textContent`)), await js(`document.querySelector("#status").textContent`));
        // APP-211: something connects while the owner sits on Today; the notice comes with the snapshot that shows it.
        mkdirSync(join(S, "Edge Vault"), { recursive: true });
        writeFileSync(join(S, "Edge Vault", "one.md"), "# One\n\nA first lesson long enough to be worth keeping.\n");
        execFileSync("uv", ["run", "lore", "sources", "connect", "obsidian", "--json", "--", join(S, "Edge Vault")], { cwd: join(__dirname, "../../.."), env: { ...process.env, OBSIDIAN_HOME: join(S, "obsidian") } });
        const toldAutomations = `[...document.querySelectorAll("#status .notice")].filter((n) => n.textContent.includes("Change this in Automations")).length`;
        check("…until something connects: nothing said before the snapshot shows it", await js(`${toldAutomations} === 0`));
        await js(`window.__lore.event({ type: "changed" })`);
        check("…then Today says once what Lore does on its own, when that snapshot lands", await waitFor(`${toldAutomations} === 1`), await js(`document.querySelector("#status").textContent`));
        await shot("today-automations-after-connect");
        // APP-211: dismissed while its write is out, and that write fails: it stays dismissed, and the next snapshot remembers it.
        for (let i = 0; i < 40 && !routinesNoticed.length; i++) await sleep(50);
        await js(`[...document.querySelectorAll("#status .notice")].find((n) => n.textContent.includes("Change this in Automations")).querySelector(".dismiss").click()`);
        await sleep(2500);
        check("dismissed while its write is out, and the write fails: it stays dismissed", routinesNoticed.length === 1 && await js(`${toldAutomations} === 0`) && await js(`window.lore.snapshot().then((s) => s.setup.automations_noticed === false)`), String(routinesNoticed.length));
        await js(`window.__lore.event({ type: "changed" })`);
        check("…the next snapshot remembers it, without showing it again", await waitFor(`window.lore.snapshot().then((s) => s.setup.automations_noticed === true)`) && routinesNoticed.length === 2 && await js(`${toldAutomations} === 0`), String(routinesNoticed.length));
        await js(`window.__lore.event({ type: "changed" })`);
        await sleep(1000);
        check("…and later snapshots leave it alone", routinesNoticed.length === 2 && await js(`${toldAutomations} === 0`), String(routinesNoticed.length));
        // APP-211: both notices unsaid again; sign in, and sign out while the slow automations write is out. Nothing queued behind it goes out.
        execFileSync("uv", ["run", "python", "-c", "from lore.store import Store\nfrom lore import automation, usage\nwith Store() as s:\n s.set_setting(automation.NOTICED, False)\n s.set_setting(usage.NOTICED_SETTING, False)"], { cwd: join(__dirname, "../../.."), env: process.env });
        await js(`auth = { credentials: [] }; enter(); true`);
        await js(`window.__lore.signIn()`);
        check("signed in again, Today says both", await waitFor(`${toldAutomations} === 1 && document.querySelector("#status").textContent.includes("anonymous usage events")`));
        for (let i = 0; i < 40 && routinesNoticed.length < 3; i++) await sleep(50);
        await js(`auth = { credentials: [] }; enter(); true`);
        const signedOut = usage.length;
        await sleep(3500);
        check("signed out while a write is out: nothing queued behind it goes out, and nothing is left told", routinesNoticed.length === 3 && usage.length === signedOut && await js(`told.size === 0`) && await js(`window.lore.snapshot().then((s) => s.setup.telemetry_noticed !== true)`), JSON.stringify(usage.slice(signedOut)));
        await js(`window.__lore.signIn()`);
        check("…and signing in again is a fresh sign-in: the one notice still unsaid shows, once", await waitFor(`document.querySelector("#status").textContent.includes("anonymous usage events")`) && await js(`[...document.querySelectorAll("#status .notice")].length === 1`), await js(`document.querySelector("#status").textContent`));
        check("…is remembered, and only then counts Lore as opened", await waitFor(`window.lore.snapshot().then((s) => s.setup.telemetry_noticed === true)`) && await waitFor(`window.lore.snapshot().then(() => true)`) && JSON.stringify(usage.slice(signedOut)) === JSON.stringify(["noticed", "app.opened"]), JSON.stringify(usage.slice(signedOut)));
      } else if (scenario === "obsidian") {
        // APP-124: an app by name, one Connect, the vault offered rather than asked for.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        await js(`window.__lore.show("connectors")`);
        const rowText = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Obsidian"))?.textContent ?? ""`;
        const rowButton = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Obsidian")).querySelector("button").click()`;
        await waitFor(rowText);
        await sleep(300);
        const offered = await js(rowText);
        check("Obsidian is offered by name, with what Lore reads and one Connect", /Your vaults and notes/.test(offered) && /Connect/.test(offered) && !/folder|source|markdown/i.test(offered), offered);
        check("the row carries the app's own mark", await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Obsidian"))?.querySelector("img.logo")?.getAttribute("src")`) === "assets/obsidian.svg");
        await shot("settings-obsidian-offered");
        await js(rowButton);
        check("Connect lists the vault by name; nothing to type or browse", await waitFor(`document.querySelector("dialog.sheet[open] .form-option")?.textContent.includes("Edge Vault")`));
        check("Connect waits for a choice", await js(`document.querySelector("dialog.sheet[open] .btn.primary").disabled`));
        await shot("obsidian-choose");
        await js(`document.querySelector("dialog.sheet[open] .form-option input").click()`);
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        check("the row turns Connected and says what was kept", await waitFor(`/Connected/.test(${rowText}) && /2 notes kept/.test(${rowText})`));
        check("the sheet closed on its own", await js(`document.querySelector("dialog.sheet[open]") === null`));
        await shot("settings-obsidian-connected");
        // A note written after connecting: Read again picks it up, no path asked for.
        writeFileSync(join(S, "Edge Vault", "three.md"), "# Three\n\nA third lesson long enough to be worth keeping.\n");
        await js(rowButton);
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        await shot("obsidian-manage");
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Read again").click()`);
        check("a note written after connecting is picked up, and Read again says so", await waitFor(`/3 notes kept/.test(${rowText})`) && await waitFor(`document.querySelector("#status").textContent.includes("1 new note.")`));
        await js(rowButton);
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Disconnect").click()`);
        check("disconnecting asks one plain question, naming the vault", await waitFor(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") === "Disconnect Edge Vault?"`) && await js(`document.querySelector("dialog.sheet[open]").textContent.includes("stay in your library")`));
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Disconnect").click()`);
        check("disconnecting offers Obsidian again and keeps the memories", await waitFor(`/Your vaults and notes/.test(${rowText})`) && await js(`document.querySelector("#status").textContent.includes("3 memories kept")`));
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
        await js(`document.querySelector("#content .next-step button").click()`);
        check("…and its button opens Connectors", await waitFor(`document.querySelector("#title").textContent === "Connectors"`));
        await js(`document.querySelector("dialog.sheet[open] .icon-btn")?.click()`);
        // Only the rows under "Your apps": Account also says Claude.
        const sourceRows = `[...[...document.querySelectorAll("#content section")].find((s) => s.querySelector("h2")?.textContent === "Your apps").querySelectorAll(".row")]`;
        const rowOf = (name) => `${sourceRows}.find((r) => r.querySelector("b").textContent === ${JSON.stringify(name)})`;
        const textOf = (name) => `(${rowOf(name)}?.textContent ?? "")`;
        const clickOn = (name) => `${rowOf(name)}.querySelector("button").click()`;
        const primary = `document.querySelector("dialog.sheet[open] .btn.primary")`;
        await waitFor(textOf("Substack"));
        await sleep(300);
        const apps = JSON.stringify(["Obsidian", "ChatGPT", "Claude", "Google Maps", "Substack", "Medium", "Bluesky", "Blog or newsletter", "Letterboxd", "Goodreads", "Granola", "Notion", "Readwise"]);
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
        await sleep(300);
        check("…and the working vault stays connected", /Edge Vault/.test(await js(textOf("Obsidian"))) && /Connected/.test(await js(textOf("Obsidian"))), await js(textOf("Obsidian")));

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
        check("with no agent, a newsletter says Lore reads it on the schedule", /new posts each time your schedule runs/.test(manage), manage);
        check("Manage offers the same next step", manage.includes(sell), manage);
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await sleep(200);

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
        await sleep(300);

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
        await js(`${primary}.click()`);
        await sleep(500);
        await key("keyDown", "Escape");
        await sleep(300);
        await js(offerOf("Medium"));
        await waitFor(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") === "Medium"`);
        await sleep(5000);
        check("a connect closed mid-read never closes the sheet opened after it", await js(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") === "Medium"`));
        check("…and connects nothing", await js(`${sourceRows}.filter((r) => r.querySelector("b").textContent === "Blog or newsletter").length`) === 2 && await js(`!document.querySelector("#status").textContent.includes("is connected")`), await js(`document.querySelector("#status").textContent`));
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await sleep(300);

        // What Read again found is said, and seen even from the bottom of a long list.
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await sleep(200);
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
        await sleep(300);

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
        await sleep(200);
        await shot("settings-connected");
        await js(`window.__lore.show("today")`);
        await sleep(300);
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
        check("the automations notice survives selling, hidden while the thread covers Today", await js(`notices.some((n) => n.key === "automations") && !document.querySelector("#status").textContent.includes("Change this in Automations")`));
        await js(`closeTask(); true`);
        check("…and shows again, once, when Today is back", await waitFor(`[...document.querySelectorAll("#status .notice")].filter((n) => n.textContent.includes("Change this in Automations")).length === 1`));
      } else if (scenario === "faq") {
        // APP-118: one page that says what Lore does and how the money works, in plain words.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        // APP-201: the sidebar holds the main places; Settings, help and feedback live in the account menu.
        const nav = await js(`[...document.querySelectorAll("nav button")].map((b) => b.dataset.view).join()`);
        check("the sidebar lists only the four main places", nav === "today,inventory,connectors,automations", nav);
        check("…and no lone feedback link outside the account menu", await js(`document.querySelector("#account-menu").contains(document.querySelector("#feedback-open")) && !document.querySelector("aside > .feedback-open")`));
        // APP-202, APP-214: How it works is for an owner with nothing kept yet (the today walk covers it); this one has memories.
        check("an owner with memories is not offered How it works", await js(`${todayShown} && document.querySelector("#content .how-it-works") === null`));
        await js(`document.querySelector("#account").click()`);
        const menu =await js(`[...document.querySelectorAll("#account-menu button:not([hidden]), #account-menu p")].map((b) => b.textContent).join("|")`);
        check("the account row opens a menu: who is signed in, then Settings, Help & FAQ, feedback when it can be sent, Dark mode and Sign out", /^Signed in with Claude\|Settings⌘,\|Help & FAQ\|(Report feedback\|)?Dark mode\|Sign out$/.test(menu), menu);
        check("…each item with its icon", await js(`[...document.querySelectorAll("#account-menu button:not([hidden])")].every((b) => b.querySelector(":scope > svg"))`));
        check("…with focus on its first item, and the row saying it is open", await js(`document.activeElement === document.querySelector("#account-menu [data-view=settings]") && document.querySelector("#account").getAttribute("aria-expanded") === "true"`));
        await shot("account-menu");
        await key("keyDown", "Escape");
        await sleep(150);
        check("Escape closes it", await js(`!document.querySelector("#account-menu").matches(":popover-open") && document.querySelector("#account").getAttribute("aria-expanded") === "false"`));
        await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", metaKey: true, bubbles: true }))`);
        check("⌘, opens Settings", await waitFor(`document.querySelector("#title").textContent === "Settings"`));
        await js(`document.querySelector("#account").click(); document.querySelector("#account-menu [data-view=faq]").click()`);
        check("Help & FAQ lands on the FAQ, and the menu closes", await waitFor(`document.querySelector("#title").textContent === "FAQ"`) && await js(`!document.querySelector("#account-menu").matches(":popover-open")`));
        await js(`window.__lore.show("faq")`);
        await waitFor(`document.querySelector("#title").textContent === "FAQ"`);
        const faq = await js(`document.querySelector("#content").textContent`);
        const questions = await js(`[...document.querySelectorAll("#content .row b")].map((b) => b.textContent)`);
        check("FAQ is a tab: what Lore is, then how to start", questions[0] === "What is Lore?" && questions[1] === "How do I start?" && questions.length >= 9, questions.join(" | "));
        check("it says Lore never holds the money", /never holds your money/.test(faq));
        check("it promises no control that isn't there", !/turn on questions|ask you one|Questions have|play money/i.test(faq), faq);
        check("it promises no earnings: the only dollar figure is a price", (faq.match(/\\$\\d/g) ?? []).length <= 1 && !/\\bearn|income|revenue|passive/i.test(faq), faq.match(/\\$\\d[^ ]*/g)?.join(",") ?? "");
        check("no jargon", !/\\bMCP\\b|x402|\\bnode\\b|worker|deploy|mainnet|testnet|endpoint|\\bAPI\\b|crypto|blockchain/i.test(faq), faq.match(/\\bMCP\\b|x402|\\bnode\\b|worker|deploy|mainnet|testnet|endpoint|\\bAPI\\b|crypto|blockchain/i)?.[0] ?? "");
        check("the buyer fork is one row that opens the buyer skill in the browser", await js(`[...document.querySelectorAll("#content .row")].filter((r) => r.textContent.includes("How do I buy?")).length === 1 && document.querySelector("#content a[href*='lore-buy']") !== null`));
        check("nothing about selling was added to Today or Settings", await js(`window.__lore.show("today"); document.querySelector("#content").textContent`).then((t) => !/Who buys|Getting paid/.test(t)) && await js(`window.__lore.show("settings"); document.querySelector("#content").textContent`).then((t) => !/Who buys|Getting paid/.test(t)));
        await js(`window.__lore.show("faq")`);
        await sleep(200);
        await shot("faq");
      } else if (scenario === "listing") {
        // XC-036: one click switches the store on and opens the prefilled request; nothing is sent from here.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.length > 0`);
        await js(`window.__lore.show("settings")`);
        const offered = await waitFor(`[...document.querySelectorAll("#content button")].some((b) => b.textContent === "List on the marketplace")`);
        check("Settings offers to list the store", offered);
        const before = await js(`document.querySelector("#content").textContent`);
        check("the row says what is shared before anything is sent", before.includes("only what your store already shows"));
        check("no PR, GitHub, or merge before the owner asks", !/\bPR\b|GitHub|merge/.test(before));
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await sleep(200);
        await shot("settings-list-offer");
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "List on the marketplace").click()`);
        const form = "https://github.com/dipakkrishnan/lore-marketplace/issues/new?template=listing.yml&node=https%3A%2F%2Fstore.example%2Fmcp";
        check("the row flips to Pending", await waitFor(`document.querySelector("#content").textContent.includes("Send the request")`));
        check("…and the prefilled request opened in the browser", opened.length === 1 && opened[0] === form, opened.join());
        check("…and stays one link away", await js(`[...document.querySelectorAll("#content a.link-btn")].some((a) => a.href === ${JSON.stringify(form)})`));
        check("…and says a GitHub account is needed", await js(`document.querySelector("#content").textContent.includes("free GitHub account")`));
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await sleep(200);
        await shot("settings-list-pending");
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Cancel").click()`);
        check("Cancel switches the store back off", await waitFor(`[...document.querySelectorAll("#content button")].some((b) => b.textContent === "List on the marketplace")`));
      } else if (scenario === "feedback") {
        // APP-105: one Send is one public GitHub issue, and a report still in
        // flight never closes a sheet the owner opened after it.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        check("the button appears once a relay is configured", await waitFor(`!document.querySelector("#feedback-open").hidden`));

        const fill = (description) => js(`(() => {
          const form = document.querySelector("dialog.sheet .feedback-form");
          const [title] = form.querySelectorAll("input");
          title.value = "Edge feedback";
          form.querySelector("textarea").value = ${JSON.stringify(description)};
          form.dispatchEvent(new Event("input", { bubbles: true }));
          return !form.querySelector(".btn.primary").disabled;
        })()`);
        const send = () => js(`document.querySelector("dialog.sheet .feedback-form").requestSubmit()`);

        await js(`document.querySelector("#account").click()`);
        check("Report feedback sits in the account menu, which opens from the account row", await waitFor(`document.querySelector("#account-menu").matches(":popover-open") && document.querySelector("#account-menu").contains(document.querySelector("#feedback-open"))`));
        await js(`document.querySelector("#feedback-open").click()`);
        check("…and the menu closes as the sheet opens", await js(`!document.querySelector("#account-menu").matches(":popover-open")`));
        check("the dialog opens", await waitFor(`!!document.querySelector("dialog.sheet .feedback-form")`));
        check("Send enables once both required fields are filled", await fill("Something to report"));
        await send();
        await sleep(300);
        // The reproduction: editing a field mid-request used to re-enable Send,
        // so a second submit filed a second issue from one owner action.
        const midFlight = await js(`(() => {
          const form = document.querySelector("dialog.sheet .feedback-form");
          form.querySelector("textarea").value = "Changed my mind";
          form.dispatchEvent(new Event("input", { bubbles: true }));
          const button = form.querySelector(".btn.primary");
          return { disabled: button.disabled, label: button.textContent };
        })()`);
        check("editing a field mid-request leaves Send disabled", midFlight.disabled === true, JSON.stringify(midFlight));
        await send();
        check("the report lands", await waitFor(`document.querySelector("#status").textContent.includes("Filed as")`));
        await sleep(1800);
        check("one owner action filed exactly one issue", relayReports.length === 1, `relay saw ${relayReports.length}`);
        await shot("feedback-filed");

        // The second reproduction: the success path used to call closeSheet(),
        // which closes whichever sheet is open — including one opened, and
        // edited, while the report was still out.
        await js(`document.querySelector("#account").click(); document.querySelector("#feedback-open").click()`);
        await waitFor(`!!document.querySelector("dialog.sheet .feedback-form")`);
        await fill("A second report");
        await send();
        await sleep(300);
        await js(`window.__lore.show("memories")`);
        await waitFor(`document.querySelectorAll("#content .task-link").length >= 1`);
        await js(`document.querySelector("#content .task-link").click()`);
        check("another sheet opens while the report is in flight", await waitFor(`!!document.querySelector("dialog.sheet .sheet-actions")`));
        await sleep(2500);
        check("the in-flight report did not close the sheet opened after it", await js(`(() => { const open = [...document.querySelectorAll("dialog.sheet")]; return open.length === 1 && open[0].open === true && !open[0].classList.contains("form-sheet"); })()`));
        check("the second report filed once", relayReports.length === 2, `relay saw ${relayReports.length}`);
        await shot("feedback-other-sheet-survives");
      } else if (scenario === "sell") {
        // APP-134: a draft previews as the page buyers will see; pasted writing is kept privately, then drafted.
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Approve what to sell")`);
        await js(`document.querySelector("#content .read-title").click()`);
        let preview;
        for (let i = 0; i < 40 && !preview; i++) { preview = window.getChildWindows()[0]; if (!preview) await sleep(250); }
        await sleep(800);
        const page = decodeURIComponent(preview?.webContents.getURL() ?? "");
        check("Preview page opens the draft's page in its own window", page.includes("When to add managers in a fast-growing team."));
        check("the preview carries no paid text", !page.includes("Add the management layer"));
        check("the preview window runs no script", preview?.webContents.getLastWebPreferences().javascript === false);
        if (preview) writeFileSync(join(S, "sell-preview.png"), (await preview.webContents.capturePage()).toPNG());
        preview?.close();
        // APP-214: the way in is Inventory's header, beside Add Memory.
        check("Today has no Sell something you wrote button; Inventory's header does", await js(`document.querySelector("#sell-writing").hidden`));
        await js(`window.__lore.show("inventory")`);
        check("…left of + Add Memory", await waitFor(`document.querySelector("#title").textContent === "Inventory" && !document.querySelector("#sell-writing").hidden && document.querySelector("#sell-writing").nextElementSibling === document.querySelector("#add-memory")`));
        await sleep(400);
        await shot("inventory-sell-writing");
        await js(`document.querySelector("#sell-writing").click()`);
        check("Sell something you wrote opens the sheet", await waitFor(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") === "Sell something you wrote"`), await js(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") ?? "none"`));
        await sleep(300);
        await js(`const t = document.querySelector("dialog.sheet[open] textarea"); t.value = "Our launch deck lost to four-minute demos.\\nTwelve cold sends, zero replies."; t.dispatchEvent(new Event("input"))`);
        await shot("sell-paste");
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Draft it for sale").click()`);
        check("Draft it for sale keeps the writing privately", await waitFor(`window.lore.search("four-minute demos").then((found) => found.some((m) => m.title === "Our launch deck lost to four-minute demos."))`));
        check("…and starts the publish thread from it", await waitFor(`document.querySelector("#log").textContent.includes("starting from \\"Our launch deck lost to four-minute demos.\\"")`));
        await shot("sell-drafting");
      } else if (scenario === "extras") {
        // New free parts for a piece already on sale wait beside new drafts, preview as its page, and approve in place.
        await js(`window.__lore.signIn()`);
        check("the update waits with the drafts", await waitFor(`document.querySelector("#content").textContent.includes("already for sale")`));
        const card = `document.querySelector("#content .extras-batch .memory")`;
        check("…showing only the free parts", await js(`${card}.querySelectorAll("textarea, input").length === 3`));
        await js(`${card}.scrollIntoView({ block: "center" })`);
        await shot("extras-card");
        await js(`[...${card}.querySelectorAll("button")].find((b) => b.textContent === "Preview page").click()`);
        let preview;
        for (let i = 0; i < 40 && !preview; i++) { preview = window.getChildWindows()[0]; if (!preview) await sleep(250); }
        await sleep(800);
        const page = decodeURIComponent(preview?.webContents.getURL() ?? "");
        check("Preview shows the new sample on the piece's page", page.includes("We had two weeks and a deck we were proud of."));
        check("the preview carries no paid text", !page.includes("Three demos, seven trials"));
        preview?.close();
        await js(`{ const t = ${card}.querySelectorAll("textarea")[1]; t.value = "you sell to developers"; t.dispatchEvent(new Event("input")); }`);
        await js(`[...${card}.querySelectorAll("button")].find((b) => b.textContent === "Approve").click()`);
        check("approving consumes the card", await waitFor(`window.lore.extras().then((left) => !left.length)`));
        check("the new drafts are untouched", await js(`window.lore.candidates().then((left) => left.length)`) === 2);
        check("the same piece stays on sale", await js(`window.lore.snapshot().then((s) => s.publications.counts.active)`) === 1);
        await shot("extras-approved");
      } else if (scenario === "settings") {
        // Settings → Your store with every row filled, then the batch of free-part updates on Today.
        const text = () => js(`document.querySelector("#content").textContent`);
        const rowOf = (label) => `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector(".t b")?.textContent === ${JSON.stringify(label)})`;
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Approve what to sell")`);
        // APP-126: a downloaded update shows one button by the Lore name, and nothing before it is ready.
        check("no update button until one is ready", await js(`document.querySelector("#update").hidden`));
        await js(`window.__lore.event({ type: "update", update: { version: "0.1.13", state: "ready" } })`);
        check("a ready update shows Update by the Lore name, on one line", await js(`(() => { const b = document.querySelector("#update"); return !b.hidden && b.textContent === "Update" && b.closest(".brand") !== null && b.getBoundingClientRect().height === 24; })()`));
        await shot("update-ready");
        const clearOfTitlebar = `(() => { const bar = document.querySelector(".titlebar"); bar.style.pointerEvents = "none"; const hits = []; for (let y = 1; y < 28; y += 3) for (let x = 1; x < innerWidth; x += 8) hits.push(document.elementFromPoint(x, y)?.closest("button, a, input, textarea, select, [tabindex]:not(#main)")); bar.style.pointerEvents = ""; return hits.every((hit) => !hit); })()`;
        check("the window drags from a strip across its whole top", await js(`(() => { const bar = document.querySelector(".titlebar"); const r = bar.getBoundingClientRect(); return getComputedStyle(bar).webkitAppRegion === "drag" && r.top === 0 && r.left === 0 && r.width === innerWidth && r.height === 28; })()`));
        check("nothing clickable sits under the drag strip", await js(clearOfTitlebar));
        await js(`document.querySelector("#main").scrollTop = 400`);
        await sleep(100);
        check("nothing clickable scrolls under the drag strip", await js(clearOfTitlebar));
        await js(`[...document.querySelectorAll("#content .memory")].at(-2)?.scrollIntoView({ block: "start" })`);
        await sleep(200);
        await shot("today-approvals");
        await js(`window.__lore.show("settings")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Listed")`);
        await sleep(300);
        await shot("settings-top");
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await sleep(200);
        await shot("settings-your-store");
        const settings = await text();
        check("no network jargon in Settings", !/Base(?![a-z])|mainnet|USDC/.test(settings), settings);
        check("the address row has one Live pill and one Open link", await js(`(() => { const r = ${rowOf("Address")}; return r.querySelector(".status-pill")?.textContent === "Live" && [...r.querySelectorAll("a.link-btn")].map((a) => a.textContent + " " + a.href).join() === "Open ↗ https://lore-edge.example.workers.dev/"; })()`));
        check("one Change control for the price, and no second payouts link", await js(`[...document.querySelectorAll("#content button")].filter((b) => /Change/.test(b.textContent)).length === 1 && ![...document.querySelectorAll("#content a")].some((a) => a.textContent === "Payouts ↗")`));
        check("the price row says the free copies", await js(`${rowOf("Price")}.textContent.includes("$1.00 per piece · first 3 copies free")`));
        await js(`window.__lore.show("store")`);
        await waitFor(`document.querySelector("#content .store-bar .price-row")`);
        await sleep(300);
        const bar = await js(`document.querySelector("#content .store-bar").textContent`);
        check("the store card reads in whole dollars and cents, no extra zeros", await js(`document.querySelector("#content .store-bar .price-row").textContent`) === "$1 a piece · first 3 copies free · $0.10 an answer", bar);
        check("…with Markets, Dashboard and Payouts as quiet links", await js(`[...document.querySelectorAll("#content .store-bar a")].map((a) => a.className + " " + a.textContent + (a.textContent === "Markets ↗" ? " " + a.href : "")).join("|")`) === "quiet-link Markets ↗ https://yourlore.dev/marketplace|quiet-link Dashboard ↗|quiet-link Payouts ↗", bar);
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
        check("Change opens one sheet for price and free copies", await js(`[...document.querySelectorAll("dialog.form-sheet[open] .form-row")].map((r) => r.querySelector(".form-label").textContent).join("|") === "Price per piece|Free copies" && document.querySelectorAll("dialog.form-sheet[open] input").length === 2 && document.querySelector("#title").textContent === "Inventory"`));
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
        await sleep(800);
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await sleep(300);
        await shot("settings-updates");
        await js(`window.__lore.event({ type: "update", update: { version: "0.1.13", state: "current" } })`);
        // APP-225: Appearance turns the window at once, sidebar material too, and the choice is kept for next launch.
        const looks = () => js(`[...${rowOf("Light or dark")}.querySelectorAll("[role=radio]")].map((b) => b.textContent + (b.getAttribute("aria-checked") === "true" ? "*" : "")).join("|")`);
        const pick = (label) => js(`[...${rowOf("Light or dark")}.querySelectorAll("[role=radio]")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        const kept = () => JSON.parse(readFileSync(join(process.env.LORE_DESKTOP_USER_DATA ?? "", "appearance.json"), "utf8")).appearance;
        check("Appearance offers Match Mac, Light and Dark, the kept one picked", (await looks()) === (DARK ? "Match Mac|Light|Dark*" : "Match Mac|Light*|Dark"), await looks());
        await pick(DARK ? "Light" : "Dark");
        check(`…and picking ${DARK ? "Light" : "Dark"} turns the window at once`, (await waitFor(`${BG} === ${JSON.stringify(DARK ? LIGHT_BG : DARK_BG)}`)) && nativeTheme.themeSource === (DARK ? "light" : "dark"), await js(BG));
        await sleep(200);
        check("…kept for the next launch", kept() === (DARK ? "light" : "dark"));
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
        await sleep(200);
        const { Appearance } = require(join(src, "appearance.cjs"));
        check("…kept as an explicit choice the next launch reads", kept() === (DARK ? "light" : "dark") && (await new Appearance(join(process.env.LORE_DESKTOP_USER_DATA ?? "", "appearance.json"), { themeSource: "system" }).read()) === (DARK ? "light" : "dark"));
        await js(`document.querySelector("#account-menu").hidePopover()`);
        check("…and Settings shows it", (await looks()) === (DARK ? "Match Mac|Light*|Dark" : "Match Mac|Light|Dark*"), await looks());
        check("…and the page reads it back as a new launch would", (await js(`window.lore.appearance()`)) === (DARK ? "light" : "dark"));
        await js(`document.querySelector("#account").click()`);
        await js(`document.querySelector("#dark-mode").click()`);
        await js(`document.querySelector("#account-menu").hidePopover()`);
        check("…and flips back", await waitFor(`${BG} === ${JSON.stringify(DARK ? DARK_BG : LIGHT_BG)}`));

        await js(`window.__lore.show("today")`);
        await waitFor(`document.querySelector("#content").textContent.includes("already for sale")`);
        const batch = `document.querySelector("#content .extras-batch")`;
        check("one header names the batch", await js(`${batch}?.querySelector(".batch-head b")?.textContent`) === "Add who-it's-for lines and samples to 2 pieces already for sale");
        check("the cards read like the buyer page, with no fields showing", await js(`[...${batch}.querySelectorAll(".fields")].every((f) => f.hidden) && ${batch}.textContent.includes("Good for") && ${batch}.textContent.includes("Not for")`));
        check("a sample shows only where there is one", await js(`${batch}.querySelectorAll(".read-sample").length === 1`));
        check("the old per-card disclaimer is gone", !(await text()).includes("Already for sale. Approving changes"));
        await js(`${batch}.scrollIntoView({ block: "start" })`);
        await sleep(200);
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
        check("…carrying the edit made on the card", /Not useful if: you have no buyers yet|not useful if: you have no buyers yet/i.test(execFileSync("uv", ["run", "lore", "publication", "list"], { cwd: join(__dirname, "../../.."), env: process.env, encoding: "utf8" })));
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
          for (let i = 0; i < 20 && copied.length === before; i++) await sleep(50);
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
        await sleep(800);
        await js(`window.__lore.event({ type: "changed" })`);
        await sleep(1500);
        const early = await js(`document.querySelector("#title").textContent === "Welcome to Lore"`);
        if (early) await js(`document.querySelector("#first-run-skip").click()`);
        await sleep(500);
        letRead();
        check("nothing starts before Lore has read where the first run stands", !early, `started early; then ${JSON.stringify(await kept())}`);

        const offer = "First, I found these on this Mac. Connect them, and Lore reads them in a few seconds.";
        check("right after sign-in, Lore opens the chat itself, speaks first, and offers what it found on this Mac", await waitFor(`document.querySelector("#title").textContent === "Welcome to Lore" && ${chat}.startsWith(${JSON.stringify(`Hi. I'm Lore. I keep what you've learned and help you sell the parts worth paying for.${offer}`)})`, 80), await js(chat));
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
        check("…and what Lore then does on its own is one quiet line in the chat, not a notice over it", await waitFor(`${chat}.includes("Change this in Automations.")`) && await js(`!document.querySelector("#status .notice")`) && await waitFor(`window.lore.snapshot().then((s) => s.setup.automations_noticed === true)`), await js(chat));
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
        check("…offering the AI the owner talks to, the one on this Mac first", JSON.stringify(picks) === JSON.stringify(["Grok BotOn this Mac", "MuseComing soon", "ChatGPT", "Claude", "Claude Code or Codex", "None of these"]), JSON.stringify(picks));
        check("…the only one found already picked, Muse not pickable", await js(`document.querySelector("#content .first-choices .choice.picked")?.textContent === "Grok BotOn this Mac" && [...document.querySelectorAll("#content .first-choices .choice")].find((c) => c.textContent.startsWith("Muse")).disabled`));
        await shot("firstrun-pick");
        await js(`[...document.querySelectorAll("#content .first-choices .choice")].find((c) => c.textContent.startsWith("Grok Bot")).click()`);
        answers++;
        check("with no store online, Grok Bot is asked to save here too, and nothing goes on sale", await waitFor(`${chat}.includes("Want Grok Bot to save here too? Grok Bot works online, so it needs a place online to save to. Lore sets one up for you, free on Cloudflare. Only your agents can save to it, and nothing goes on sale.")`), await js(chat));
        check("…and the owner's answer, a pill, says who gave it to a screen reader", await js(`document.querySelector("#content .first-run .line.owner > .sr-only")?.textContent === "You: "`));
        await shot("firstrun-store");
        // APP-223: a sign-in left open in the browser can be opened again, or cancelled, and never strands the card.
        const pages = () => opened.filter((url) => url.startsWith("https://dash.cloudflare.com/")).length;
        const buttons = `[...document.querySelectorAll("#content .first-run button")].map((b) => b.textContent)`;
        signInHangs = true;
        await tap("Set it up");
        check("while Cloudflare's sign-in waits on the browser, the card offers it again, or Cancel", await waitFor(`${chat}.includes("Finish signing in to Cloudflare in your browser") && ${buttons}.includes("Open sign-in again") && ${buttons}.includes("Cancel")`, 80) && pages() === 1, `${pages()} pages; ${await js(chat)}`);
        await shot("firstrun-sign-in-waiting");
        await tap("Open sign-in again");
        check("…Open sign-in again opens the same page", await waitFor(`true`) && pages() === 2 && opened.at(-1) === opened.at(-2), JSON.stringify(opened.slice(-2)));
        await tap("Cancel");
        check("…and Cancel stops it, back at Set it up with nothing to say", await waitFor(`${buttons}.includes("Set it up") && !${buttons}.includes("Cancel")`, 40) && !(await js(`Boolean(document.querySelector("#content .first-run .problem"))`)), await js(chat));
        signInWait = 2000;
        await tap("Set it up");
        check("a sign-in that never finishes gives up after a while, plainly, with Set it up again", await waitFor(`${chat}.includes("Cloudflare sign-in didn't finish. Try again.") && ${buttons}.includes("Set it up")`, 60), await js(chat));
        signInHangs = false;
        signInWait = undefined;
        storeElsewhere = true;
        await tap("Set it up");
        check("an account that already has a Lore store is told so, and nothing is set up there", await waitFor(`${chat}.includes("This Cloudflare account already has a Lore store. Sign in with a different account, or reconnect that store from the Mac that set it up.") && ${buttons}.includes("Set it up")`, 60) && await js(`window.lore.snapshot().then((s) => !s.node.url)`), await js(chat));
        await shot("firstrun-store-elsewhere");
        storeElsewhere = false;
        emailUnverified = true;
        await tap("Set it up");
        check("an account whose email isn't verified yet is told what to do, plainly", await waitFor(`${chat}.includes("Cloudflare needs you to verify your email first. Check your inbox for their email, click the link, then tap Set it up again.") && ${buttons}.includes("Set it up")`, 60), await js(chat));
        await shot("firstrun-verify-email");
        emailUnverified = false;
        await tap("Set it up");
        answers++;
        check("putting it online signs in to Cloudflare first, then puts it online for agents only", await waitFor(`document.querySelector("#content .first-run .agent-link")`, 80) && JSON.stringify(storeOnlineCalls) === JSON.stringify([false, false, false, true, true, true]), JSON.stringify(storeOnlineCalls));
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
        await sleep(300);
        await tap("Get a new link");
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
        check("…and nothing shimmers once it has saved", await js(`!document.querySelector("#content .first-run .shimmer")`));
        // APP-230: the message it was sent already set up its routine, so the first run ends on the next AI or Today.
        check("…without asking a second time for the routine", !(await js(chat)).includes("routine"), await js(chat));
        check("…and ends on Connect another AI beside Go to Today", await js(`[...document.querySelectorAll("#content .first-run-actions button")].map((b) => b.textContent).join("|")`) === "Connect another AI|Go to Today", await js(`document.querySelector("#content .first-run-actions")?.textContent ?? ""`));
        await shot("firstrun-saved");
        await js(`[...${savedCard}.querySelectorAll("button.inline")].find((b) => b.textContent === "See them →").click()`);
        const chip = `document.querySelector("#content .source-filter")?.textContent ?? ""`;
        check("See them lands on Inventory, with everything that came in", await waitFor(`document.querySelector("#title").textContent === "Inventory" && !(${chip})`), await js(chip));
        check("…what Grok Bot saved and what the apps brought in", await waitFor(`[...document.querySelectorAll("#content .row .t b")].some((b) => b.textContent.startsWith("Send the cue sheet with the invoice")) && [...document.querySelectorAll("#content .row .t b")].some((b) => b.textContent.startsWith("Ship the smallest change"))`), await js(`[...document.querySelectorAll("#content .row .t b")].map((b) => b.textContent).join("|")`));
        await shot("firstrun-see-them");
        await relaunch();
        check("once done, a relaunch opens on Today", await waitFor(todayShown, 80) && await js(`document.querySelector("#title").textContent !== "Welcome to Lore" && document.querySelector("#first-run-skip").hidden && !document.querySelector("#capture").hidden`), await js(`document.querySelector("#title").textContent`));

        // Skip for now: the chat steps aside for Today's one next step, and stays aside.
        await js(`window.lore.setFirstRun({ state: "started" })`);
        await relaunch();
        check("a chat not finished opens again", await waitFor(`document.querySelector("#title").textContent === "Welcome to Lore"`, 80));
        await js(`document.querySelector("#first-run-skip").click()`);
        check("Skip for now lands on Today with its one next step", await waitFor(`document.querySelector("#title").textContent !== "Welcome to Lore" && document.querySelectorAll("#content .next-step").length === 1`), await js(`document.querySelector("#content").textContent`));
        check("…and is kept as skipped", await waitFor(`window.lore.firstRun().then((k) => k?.state === "skipped")`), JSON.stringify(await kept()));
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
          await sleep(2000);
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
        await sleep(200);
        const offered = await js(`[...document.querySelectorAll("#content .first-run button")].filter((b) => !b.disabled).map((b) => b.textContent)`);
        await js(`[...document.querySelectorAll("#content .first-run button")].find((b) => b.textContent === "Try again")?.click()`);
        await sleep(300);
        check("…Try again asks once, its error gone while it does, and nothing else can be chosen meanwhile", connects() === askedBefore + 1 && !offered.includes("Choose another") && !offered.includes("Try again") && (await js(chat)).includes("Getting ChatGPT's link…"), `${connects() - askedBefore} asks; ${JSON.stringify(offered)}`);
        letRetry();
        check("…and the link it asked for is the one shown", await waitFor(`document.querySelector("#content .first-run .agent-link")`, 80));
        execFileSync("uv", ["run", "python", "-c", "from lore.store import Store\nwith Store() as s:\n s.set_setting('node_url', None)"], { cwd: join(__dirname, "../../.."), env: process.env });
        await js(`window.lore.setFirstRun({ state: "started" })`);
        await relaunch();
        await picker();
        await js(`[...document.querySelectorAll("#content .first-choices .choice")].find((c) => c.textContent.startsWith("Claude")).click()`);
        await waitFor(`${chat}.includes("Set it up")`);
        const letOnline = hold("store:online");
        const connectsBefore = connects();
        await tap("Set it up");
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
        check("Today's one next step is to connect the owner's AI", await waitFor(`(document.querySelector("#content .next-step")?.textContent ?? "").includes("Connect the AI you talk to most")`) && !/Claude Code|Codex/.test(await js(todayText)), await js(todayText));
        await js(`window.__lore.show("connectors")`);
        check("Connectors has a group for the owner's agents, offering to connect one", await waitFor(`${agentRow("Connect an agent")}?.querySelector("img.logo")`));
        check("…and the catalog offers no generic Personal agent", !(await js(`[...document.querySelectorAll("#content .row b")].some((b) => b.textContent === "Personal agent")`)));
        await shot("agents-offer");

        // No store online: the sheet puts it online first, the way the store always goes online, then picks up.
        installedApps = ["grok", "claude"];
        await js(`${agentRow("Connect an agent")}.querySelector("button").click()`);
        await waitFor(`${primary}?.textContent === "Put your store online"`);
        await sleep(400);
        check("with no store online, the first step says why it goes online, plainly", await js(`${sheet}.includes("Your agents work online, so they need a place online to save to. Lore sets one up for you, free on Cloudflare. Only your agents can save to it, and nothing goes on sale until you choose to sell it.")`), await js(sheet));
        await shot("agents-store-first");
        await js(`${primary}.click()`);
        const deploying = await waitFor(`document.querySelector("#title").textContent === "Open your store"`);
        for (let i = 0; i < 40 && !prompts.length; i++) await sleep(100);
        check("…and puts it online through the store's own deploy", deploying && prompts.some((p) => p.task === "deploy" && /personal agents/.test(p.text)), JSON.stringify(prompts));
        check("once the store is online, the sheet continues to the setup", await waitFor(`${sheet}.includes("Which agent should save to Lore?")`, 80), await js(sheet));
        const picks = await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].map((o) => o.textContent)`);
        check("…offering each of the five, each with its mark, Muse as coming soon", JSON.stringify(picks) === JSON.stringify(["Grok Bot", "MuseComing soon", "ChatGPT", "Claude", "Other"]) && await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].every((o) => o.querySelector("img.logo"))`), JSON.stringify(picks));
        check("Connect waits for a choice", await js(`${primary}.disabled`));
        // APP-217: Muse can't be chosen, and nothing mints a key for it, not even a call past the sheet.
        const keys = async () => (await js(`window.lore.agents()`)).length;
        const keysBefore = await keys();
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent.startsWith("Muse")).click()`);
        await sleep(300);
        check("Muse can't be picked, so Connect still waits", await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent.startsWith("Muse")).querySelector("input").disabled && ${primary}.disabled`));
        await shot("agents-muse-soon");
        const refused = await js(`window.lore.connectAgent({ app: "muse", name: "Muse" }).then(() => "connected", (error) => error.message)`);
        check("…a Muse connect is refused, and mints no key", /Choose an agent/.test(refused) && (await keys()) === keysBefore, `${refused}; ${keysBefore} keys before, ${await keys()} after`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent === "Grok Bot").querySelector("input").click()`);
        await sleep(400);
        await shot("agents-pick");
        await js(`${primary}.click()`);
        // XC-068: Grok Bot signs in first: the plain address, with no key in it, and a wait here for it to ask.
        const instead = () => js(`[...document.querySelectorAll("dialog.sheet[open] button.inline")].find((b) => b.textContent === "Can't sign in? Use a private link instead").click()`);
        check("Grok Bot signs in: the sheet gives its steps and waits for it to ask", await waitFor(`${sheet}.includes("Waiting for Grok Bot to ask to sign in…")`, 80) && JSON.stringify(await js(`[...document.querySelectorAll("dialog.sheet[open] .agent-steps li")].map((s) => s.firstChild.textContent)`)) === JSON.stringify(["Copy the message", "Paste it into Grok Bot's chat", "When Grok Bot opens a sign-in page, allow it here"]), await js(sheet));
        check("…with no key in it, said plainly", !/••••|lore_agent_|token|bearer|oauth/i.test(await js(sheet)) && (await js(sheet)).includes("No key in it. You allow it here"), await js(sheet));
        {
          const before = copied.length;
          await js(`document.querySelector("dialog.sheet[open] .agent-link").click()`);
          for (let i = 0; i < 20 && copied.length === before; i++) await sleep(50);
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
        const todayNow = `renderToday(snapshot).map((p) => p.textContent).join(" ")`;
        check("as soon as Grok Bot is connected, before its first save, Today stops asking to connect an agent", await waitFor(`snapshot.library.counts.private === 0 && snapshot.library.sources.some((s) => s.connector === "agent") && !(${todayNow}).includes("Connect the AI you talk to most")`, 80), await js(todayNow));
        await press("Open Grok Bot");
        for (let i = 0; i < 20 && !launched.length; i++) await sleep(50);
        check("Grok Bot on this Mac: Open Grok Bot opens it, by its id", JSON.stringify(launched) === JSON.stringify(["grok"]), JSON.stringify(launched));
        const copyLink = async () => {
          const before = copied.length;
          // The bare link where there is one; Grok Bot has only its message.
          await js(`(document.querySelector("dialog.sheet[open] .agent-link:not(.agent-message)") ?? document.querySelector("dialog.sheet[open] .agent-link")).click()`);
          for (let i = 0; i < 20 && copied.length === before; i++) await sleep(50);
          return copied.at(-1) ?? "";
        };
        const copyOf = async (label) => {
          const before = copied.length;
          await js(`[...document.querySelectorAll("dialog.sheet[open] .copy-row")].find((r) => r.querySelector(".form-label").textContent === ${JSON.stringify(label)}).querySelector("button").click()`);
          for (let i = 0; i < 20 && copied.length === before; i++) await sleep(50);
          return copied.at(-1) ?? "";
        };
        const linked = (/** @type {string} */ lead) => new RegExp(`^${(lead + agentUrl).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/lore_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$`);
        const ask = "Add this MCP server to my account: ";
        const message = await copyLink();
        check("Copy message gives exactly the message, with the link and its key", linked(ask).test(message), message);
        // The clipboard stand-in records the copy before the renderer hears back, so wait for the link to say it.
        check("…and it says it copied", await waitFor(`document.querySelector("dialog.sheet[open] .agent-link").classList.contains("copied") && document.querySelector("dialog.sheet[open] .agent-link").textContent.includes("Copied")`, 20));
        check("…and no way to add it by hand, which Grok Bot doesn't have", !(await js(`/Copy link only|add it yourself/.test(document.querySelector("dialog.sheet[open]").textContent)`)));
        await sleep(1600);
        await shot("agents-setup");
        await shot("agents-grok-setup");

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
        for (let i = 0; i < 20 && copied.length === copiedBefore; i++) await sleep(50);
        check("…with one quiet Copy that copies it", copied.at(-1) === evening && await js(`[...document.querySelectorAll("dialog.sheet[open] .agent-next")].every((n) => n.querySelectorAll("button").length === 1 && n.querySelector("button").classList.contains("quiet"))`), String(copied.at(-1)));
        await shot("agents-first-save");
        check("…read through once, named for Grok", readings.length === 1 && readings[0].title === "Grok Bot saved 2 things to Lore" && readings[0].label === "Grok Bot", JSON.stringify(readings));
        // APP-212: each way in lands on Inventory, filtered to Grok Bot, with what the owner hasn't seen marked New.
        const chip = `document.querySelector("#content .source-filter")?.textContent ?? ""`;
        const rowOf = (title) => `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector(".t b")?.textContent.startsWith(${JSON.stringify(title)}))`;
        const isNew = (title) => `Boolean(${rowOf(title)}?.querySelector(".new-mark"))`;
        const listed = `[...document.querySelectorAll("#content .row .t b")].map((b) => b.textContent).join("|")`;
        await js(`[...document.querySelectorAll("dialog.sheet[open] button.inline")].find((b) => b.textContent === "See them →").click()`);
        check("See them closes the sheet and lands on Inventory, filtered to Grok Bot", await waitFor(`document.querySelector("#title").textContent === "Inventory" && !document.querySelector("dialog.sheet[open]") && (${chip}) === "Grok Bot×"`), await js(chip));
        check("…with both things Grok Bot saved marked New, and nothing else", await waitFor(`${isNew("How I price sync placements")} && ${isNew("Quote sync fees in the buyer's currency")}`) && (await js(`document.querySelectorAll("#content .row").length`)) === 2, await js(listed));
        await shot("agents-see-them-sheet");
        await js(`window.__lore.show("connectors")`);
        // APP-233: what Grok saved is announced as it comes in, while the reading of it is still held.
        for (let i = 0; i < 60 && !notes.length; i++) await sleep(250);
        check("its saves are one Mac notification that names Grok, before any reading of them", notes.length === 1 && notes[0].words.title === "Grok Bot saved 2 things to Lore" && notes[0].words.body === "2 new memories. They stay private on this Mac.", JSON.stringify(notes.map((n) => n.words)));
        check("…and a red 2 on the dock", badges.at(-1) === 2, JSON.stringify(badges));
        releaseReading();
        // The count moves when the reading's memories join the card; crediting them to Grok comes after, so wait for both.
        for (let i = 0; i < 80 && (badges.at(-1) !== 3 || readingsLanded < 1); i++) await sleep(250);
        check("what Lore wrote from them joins the count, a red 3, and says nothing more", badges.at(-1) === 3 && notes.length === 1, JSON.stringify([badges, notes.length]));
        check("Grok's row says what it saved, and when", await waitFor(`/Saved 2 · last today/.test(${agentRow("Grok Bot")}?.textContent ?? "")`), await js(`${agentRow("Grok Bot")}?.textContent ?? ""`));
        check("…with Grok's mark, and the offer to connect another", await js(`${agentRow("Grok Bot")}.querySelector("img.logo").src.endsWith("assets/grok.svg") && Boolean(${agentRow("Connect another agent")})`));
        await shot("agents-connected");
        app.emit("browser-window-focus");
        await sleep(3000);
        check("coming back to the app finds nothing more, and says nothing again", notes.length === 1 && readings.length === 1, String(notes.length));

        notes[0].handlers.click();
        check("clicking it lands on what Grok Bot saved, in Inventory", await waitFor(`document.querySelector("#title").textContent === "Inventory" && (${chip}) === "Grok Bot×"`), await js(chip));
        check("…the memory Lore wrote from it marked New, what was seen already not", await waitFor(isNew("Price a sync placement by its reach")) && !(await js(isNew("How I price sync placements"))), await js(listed));
        await shot("agents-see-them-notification");
        await js(`window.__lore.show("today")`);
        const card = `[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("New memories"))`;
        check("Today's new memories are one folded card named for Grok", await waitFor(`${card}?.querySelector(".ready-head")?.textContent.includes("From Grok Bot3 new memories · 1 worth selling")`) && !(await js(`Boolean(${card}.querySelector(".ready-items"))`)), await js(`${card}?.textContent ?? ""`));
        await js(`${card}.querySelector(".ready-head .task-link").click()`);
        check("…which opens onto what Lore wrote from it", await waitFor(`${card}?.querySelector(".ready-items")?.textContent.includes("Price a sync placement by its reach")`));
        const cardText = await js(`${card}.textContent`);
        check("…each memory saying what it is to the owner", cardText.includes("Worth selling · "), cardText);
        check("…with Grok Bot's mark in its tile", await js(`${card}.querySelector(".row .mark-stack .routine-mark img.logo")?.src.endsWith("assets/grok.svg")`));
        // APP-211: with an agent connected, Today now says once what Lore does on its own.
        const told = `[...document.querySelectorAll("#status .notice")].filter((n) => n.textContent.includes("Change this in Automations"))`;
        check("with Grok connected, Today says once that Lore reads and checks in on its own", await waitFor(`${told}.length === 1`) && (await js(`${told}[0].textContent`)).startsWith("Lore reads your connected apps every day at 9 AM and checks in at 6 PM when something's worth asking."), await js(`document.querySelector("#status").textContent`));
        check("…and remembers having said it", await waitFor(`window.lore.snapshot().then((s) => s.setup.automations_noticed === true)`));
        // APP-211: a refresh that still reads "not said" (as one started before the write would) never says it twice.
        execFileSync("uv", ["run", "python", "-c", "from lore.store import Store\nwith Store() as s:\n s.set_setting('automations_noticed', False)"], { cwd: join(__dirname, "../../.."), env: process.env });
        await js(`window.__lore.event({ type: "changed" })`);
        check("a refresh then reads it as unsaid, in the store and in the window", await waitFor(`window.lore.snapshot().then((s) => s.setup.automations_noticed === false)`) && await waitFor(`snapshot.setup.automations_noticed === false`));
        await sleep(1000);
        await js(`window.__lore.show("inventory")`);
        await js(`window.__lore.show("today")`);
        await sleep(300);
        check("after a refresh that reads it as unsaid, Today still shows exactly one", await js(`${told}.length === 1`), String(await js(`${told}.length`)));
        await shot("agents-today");
        check("with Grok Bot connected, Today never asks to connect an agent", !(await js(`${todayText}.includes("Connect the AI you talk to most")`)) && !/Claude Code|Codex/.test(await js(todayText)), await js(todayText));
        const order = await js(`JSON.stringify([...document.querySelectorAll("#content .section-head h2")].map((h) => h.textContent))`);
        check("…its new memories lead, and the next step follows them", /"New memories".*"Next step"/.test(order), order);
        await js(`[...${told}[0].querySelectorAll("button")].find((b) => b.textContent === "Automations").click()`);
        check("its Automations button opens Automations, which carries no notice", await waitFor(`document.querySelector("#title").textContent === "Automations"`) && await js(`!document.querySelector("#status .notice")`));
        await js(`window.__lore.show("today")`);
        await sleep(300);
        check("…and it is not said again", await js(`${told}.length === 0`));
        await js(`window.__lore.show("memories")`);
        const saved = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How I price sync placements"))`;
        // APP-208: a date-only save shows the day it names, whatever the Mac's time zone.
        check("a date-only save shows the day it names", await js(`when("2026-10-17")`) === "Oct 17" && await js(`when("2026-10-17T03:00:00Z")`) === await js(`new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date("2026-10-17T03:00:00Z"))`));
        check("what Grok Bot saved is in Memories, from Grok", await waitFor(`/From Grok Bot/.test(${saved}?.textContent ?? "")`), await js(`${saved}?.textContent ?? ""`));
        await js(`${saved}.querySelector(".task-link").click()`);
        check("…and its sheet says so", await waitFor(`/From Grok Bot/.test(document.querySelector("dialog.sheet[open] .sheet-head")?.textContent ?? "")`), await js(sheet));
        await shot("agents-memory-from");
        await js(`document.querySelector("dialog.sheet[open] .icon-btn[aria-label=Close]").click()`);
        // APP-213: the memory Lore wrote from what Grok saved is Grok's too, in Inventory and in its preview.
        const written = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Price a sync placement by its reach"))`;
        check("in Inventory, what Lore wrote from Grok's save says it came from Grok, with its mark", await waitFor(`/From Grok Bot · /.test(${written}?.textContent ?? "") && ${written}.querySelector(".mark-stack img.logo")?.src.endsWith("assets/grok.svg")`), await js(`${written}?.textContent ?? ""`));
        check("…and so does what Grok saved itself", await js(`${saved}.querySelector(".mark-stack img.logo")?.src.endsWith("assets/grok.svg")`));
        // Any refresh hides a preview (render() does), so the pointer comes back to the row until one stays up.
        const peekLine = `document.querySelector(".peek .provenance")?.textContent ?? ""`;
        for (let i = 0; i < 5 && !(await js(`Boolean(document.querySelector(".peek"))`)); i++) {
          await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Price a sync placement by its reach")).querySelector(".task-link").dispatchEvent(new MouseEvent("mouseenter"))`);
          await waitFor(`document.querySelector(".peek")`, 8);
        }
        check("its preview leads with where it came from, then the day", await waitFor(`/^From Grok Bot · [A-Z][a-z]{2} \\d{1,2}$/.test(${peekLine})`) && await js(`document.querySelector(".peek .provenance img.logo")?.src.endsWith("assets/grok.svg")`), await js(peekLine));
        await shot("agents-preview");
        await js(`${written}.querySelector(".task-link").dispatchEvent(new MouseEvent("mouseleave"))`);

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
        await shot("agents-new-key");
        await shot("agents-grok-new-key");
        // The old key's waiting save comes in now, and is not taken for the new link working.
        const readBefore = readings.length;
        await js(`window.lore.checkAgents()`);
        for (let i = 0; i < 80 && readings.length === readBefore; i++) await sleep(250);
        check("the old key's late save is brought in while the new link waits", readings.length > readBefore, JSON.stringify(readings.map((r) => r.title)));
        // Long enough for the sheet's own check, which runs every 10 seconds, to have looked again.
        await sleep(11_000);
        check("…and the sheet still waits for the new link's first save", await js(`${sheet}.includes("Waiting for Grok Bot's next save…") && !${sheet}.includes("saved with the new link")`), await js(sheet));
        // Grok saves again what it already saved, word for word: nothing changes in Lore, and it still shows the link works.
        const resaved = await (await call(fresh, "tools/call", { name: "store", arguments: { items: [{ title: "How I price sync placements", content: "I charge by the audience the placement reaches, not by the hours it took.", key: "sync-pricing", kind: "preference" }] } })).json();
        check("an unchanged save with the new link reaches the store", resaved.result?.isError === false, JSON.stringify(resaved));
        check("…and the sheet shows the new link works", await waitFor(`${sheet}.includes("Grok Bot saved with the new link")`, 80) && !(await js(`Boolean(document.querySelector("dialog.sheet[open] .agent-next"))`)), await js(sheet));
        await press("Done");
        await sleep(300);
        /** Grok saves one more thing, and Lore brings it in and reads it through. @param {string} title */
        const saveMore = async (title) => {
          const [told, landed] = [notes.length, readingsLanded];
          await call(fresh, "tools/call", { name: "store", arguments: { items: [{ title, content: `${title}, as I actually do it.`, kind: "preference" }] } });
          app.emit("browser-window-focus");
          // APP-233: the notification comes as the save is read in; what Lore writes from it lands after.
          for (let i = 0; i < 80 && (notes.length === told || readingsLanded === landed); i++) await sleep(250);
          return notes.length === told + 1 && readingsLanded > landed;
        };
        const more = await saveMore("How I quote a rush job");
        check("another save lands while the owner is on Connectors", more, JSON.stringify([notes.map((n) => n.words), readingsLanded, readings.length]));
        const savedLink = `[...(${agentRow("Grok Bot")}?.querySelectorAll("button.inline") ?? [])].find((b) => b.textContent === "Saved 5")`;
        // APP-233: the notification comes as the save is read in, ahead of the store's own count, so give that its time.
        check("Grok Bot's card says Saved 5, as a link", await waitFor(savedLink, 80), await js(`${agentRow("Grok Bot")}?.textContent ?? ""`));
        await js(`${savedLink}.click()`);
        check("…which lands on what it saved, filtered to Grok Bot", await waitFor(`document.querySelector("#title").textContent === "Inventory" && (${chip}) === "Grok Bot×"`), await js(chip));
        check("…the new save and what Lore wrote from it marked New, the rest not", await waitFor(`${isNew("How I quote a rush job")} && ${isNew("Quote a rush fee up front")}`) && !(await js(`${isNew("How I price sync placements")} || ${isNew("Price a sync placement by its reach")}`)), await js(listed));
        await shot("agents-see-them-card");
        // Seen means on screen: with the old key's late note listed too, what Lore wrote from the rush job sits below the fold.
        const rush = await js(`${rowOf("Quote a rush fee up front")}.dataset.memory`);
        await js(`${rowOf("Quote a rush fee up front")}.scrollIntoView({ block: "center" })`);
        check("…and once on screen it is kept as seen", await waitFor(`window.lore.memoriesSeen(0).then((kept) => kept.arrivals.includes(${Number(rush)}))`, 20), rush);
        await js(`window.__lore.show("today")`);
        check("a third save lands while the owner is on Today", await saveMore("How I bill a rerun"));
        const headerLink = `[...(${card}?.querySelectorAll(".ready-head button.inline") ?? [])].find((b) => b.textContent === "See them →")`;
        check("Today's new memories, all from Grok Bot, link to what it saved", await waitFor(`${card}?.textContent.includes("Bill a rerun at half the first fee") && ${headerLink}`, 80), await js(`${card}?.querySelector(".list-aside")?.textContent ?? ""`));
        await shot("agents-today-see-them");
        await js(`${headerLink}.click()`);
        check("…which lands filtered to Grok Bot", await waitFor(`document.querySelector("#title").textContent === "Inventory" && (${chip}) === "Grok Bot×"`), await js(chip));
        check("…the third save and what Lore wrote from it marked New, the rest not", await waitFor(`${isNew("How I bill a rerun")} && ${isNew("Bill a rerun at half the first fee")}`) && !(await js(`${isNew("How I quote a rush job")} || ${isNew("Quote a rush fee up front")}`)), await js(listed));
        await shot("agents-see-them-inventory");
        // Seen means on screen: the last row is below the fold until the owner scrolls to it.
        await js(`${rowOf("Bill a rerun at half the first fee")}.scrollIntoView({ block: "center" })`);
        const seenIds = await js(`window.lore.snapshot().then((s) => s.library.items.filter((i) => /rerun/i.test(i.title)).map((i) => i.arrival))`);
        const seenFile = join(process.env.LORE_DESKTOP_USER_DATA ?? "", "memories-seen.json");
        const kept = async () => (await new (require(join(src, "reading.cjs")).Seen)(seenFile).read(0)).arrivals;
        check("once on screen, they are kept as seen on disk, for the next launch", await (async () => { for (let i = 0; i < 20; i++) { const ids = await kept(); if (seenIds.length === 2 && seenIds.every((id) => ids.includes(id))) return true; await sleep(250); } return false; })(), JSON.stringify([seenIds, await kept()]));
        await js(`window.__lore.show("connectors")`);
        await js(`window.__lore.show("memories")`);
        check("…and New clears on the next visit", await waitFor(`${rowOf("How I bill a rerun")} && !document.querySelector("#content .new-mark")`), await js(listed));
        // The window closed, Grok saves once more, and its notification opens a new window on what it saved.
        window.close();
        for (let i = 0; i < 20 && !window.isDestroyed(); i++) await sleep(100);
        check("a save lands while Lore's window is closed", await saveMore("How I sign off a cut"));
        notes.at(-1)?.handlers.click();
        let reopened = null;
        for (let i = 0; i < 40 && !reopened; i++) {
          reopened = BrowserWindow.getAllWindows().find((each) => !each.isDestroyed() && !each.getParentWindow()) ?? null;
          await sleep(100);
        }
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
        check("…with the new save and what Lore wrote from it marked New", await waitFor(`${isNew("How I sign off a cut")} && ${isNew("Get the final cut signed off in writing")}`) && !(await js(isNew("How I bill a rerun"))), await js(listed));
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
        check("…and what it saved still says Grok Bot, with its mark", await waitFor(`/From Grok Bot/.test(${saved}?.textContent ?? "") && ${saved}.querySelector(".mark-stack img.logo")?.src.endsWith("assets/grok.svg")`), await js(`${saved}?.textContent ?? ""`));
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
          // A private link, for the agents that would sign in first (XC-068).
          if (await waitFor(`${sheet}.includes(${JSON.stringify(`Waiting for ${name} to ask to sign in…`)})`, 8)) await instead();
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
          await sleep(300);
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
        await sleep(300);
        await shot("agents-claude-new-key");
        await press("Done");
        // XC-068: ChatGPT signs in. The store's sign-in page asks; Lore shows the Allow card with the page's code.
        const askSignIn = (/** @type {string} */ client) => JSON.parse(execFileSync("uv", ["run", "python", "-m", "tests.fixtures.inbox", "ask", "--client", client], { cwd: process.env.LORE_EDGE_REPO, env: process.env }).toString());
        const signInRow = (/** @type {string} */ id) => JSON.parse(execFileSync("uv", ["run", "python", "-c", `import json, sqlite3, os\nrow = sqlite3.connect(os.environ["LORE_EDGE_D1"]).execute("SELECT state, agent FROM sign_ins WHERE id = ?", (${JSON.stringify(id)},)).fetchone()\nprint(json.dumps(row))`], { cwd: process.env.LORE_EDGE_REPO, env: process.env }).toString());
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
        await sleep(400);
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
        await js(`window.lore.checkAgents()`);
        await sleep(1000);
        check("…and it is not asked about again", !(await js(`Boolean(document.querySelector("dialog.sheet[open]"))`)));
        check("Other keeps a link, and the address and key for apps that ask for both", await connectNew("Other", "My agent") && await js(`document.querySelectorAll("dialog.sheet[open] .agent-link").length === 1 && JSON.stringify([...document.querySelectorAll("dialog.sheet[open] .copy-row .form-label")].map((l) => l.textContent)) === '["Address","Key","Instructions"]'`), await js(sheet));
        check("…with no sign-in notice", !/offer yet/.test(await js(sheet)), await js(sheet));
        check("…and its instructions name it", (await copyOf("Instructions")).includes("You are My agent"));
        await sleep(300);
        await shot("agents-other-setup");
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
        await js(`document.querySelector("#content .source-filter .dismiss").click()`);
        check("…and removing the chip shows everything again", await waitFor(`!document.querySelector("#content .source-filter") && Boolean(${rowOf("Ship the smallest change that proves it")}) && Boolean(${rowOf("How I bill a rerun")})`), await js(listed));
        await js(`window.__lore.show("connectors")`);
        await waitFor(claudeCode);
        await js(`${claudeCode}.click()`);
        await waitFor(`${primary}?.textContent === "Turn off"`);
        await js(`${primary}.click()`);
        check("…Turn off keeps what it brought in and says so", await waitFor(`document.querySelector("#status").textContent.includes("Turned off Claude Code. What it brought in stays.") && ${claudeCode}?.querySelector("button")?.textContent === "Connect"`, 80), await js(`document.querySelector("#status").textContent`));

        // XC-069: the store went online only for the agents. Nothing in the app says anything is for sale, and
        // opening it for sale is still the first approved piece's own step, with a price and where payments go.
        check("the deploy thread asked only to put the store online for the agents", prompts.some((p) => p.task === "deploy") && prompts.filter((p) => p.task === "deploy").every((p) => /personal agents/.test(p.text) && !/price|payout|wallet/i.test(p.text)), JSON.stringify(prompts));
        check("the store is online for agents, not open for sale", await js(`window.lore.snapshot().then((s) => Boolean(s.node.url) && s.node.selling === false)`));
        await js(`window.__lore.show("store")`);
        const bar = `(document.querySelector("#content .store-bar")?.textContent ?? "")`;
        check("For Sale says nothing is for sale yet, and offers to open the store", await waitFor(`/Nothing for sale yet/.test(${bar}) && /Open your store/.test(${bar}) && !/\\bLive\\b|Payouts/.test(${bar})`), await js(bar));
        await shot("agents-nothing-for-sale");
        await js(`window.__lore.show("settings")`);
        check("…and Settings offers no marketplace listing for it", await waitFor(`document.querySelector("#content")?.textContent.includes("Address")`) && !(await js(`[...document.querySelectorAll("#content .row b")].some((b) => b.textContent === "Marketplace")`)));
        await js(`window.__lore.show("today")`);
        check("…and Today offers no store update", await waitFor(todayShown) && !(await js(`/Update store|live yet/.test(document.querySelector("#content").textContent)`)), await js(`document.querySelector("#content").textContent`));
        // The first approved piece: opening the store for sale asks for a price and where payments go, as always.
        execFileSync("uv", ["run", "python", "-c", "from lore.store import Store\nwith Store() as s:\n first = s.db.execute('SELECT min(id) FROM memories').fetchone()[0]\n s.add_publication(title='Price a sync placement by its reach', content='Charge by the audience.', topic='licensing', teaser='How to price a sync placement', provenance=[first])"], { cwd: process.env.LORE_EDGE_REPO, env: process.env });
        await js(`window.__lore.event({ type: "changed" })`);
        const rung = `document.querySelector("#content .next-step")`;
        check("the first approved piece offers to open the store, with a price and where payments go", await waitFor(`/Pick a price and where payments go/.test(${rung}?.textContent ?? "")`, 80), await js(`document.querySelector("#content").textContent`));
        await js(`window.__lore.show("inventory")`);
        const shelves = await js(`[...document.querySelectorAll(".shelf")].map((s) => s.textContent).join("|")`);
        check("…and Inventory calls it ready to sell, not on sale", /Ready to sell1/.test(shelves) && !/On sale/.test(shelves), shelves);
        await js(`window.__lore.show("today")`);
        await waitFor(`/Pick a price and where payments go/.test(${rung}?.textContent ?? "")`);
        const before = prompts.length;
        await js(`${rung}.querySelector("button").click()`);
        for (let i = 0; i < 40 && prompts.length === before; i++) await sleep(100);
        check("…through the store's usual opening, not the agents' one", prompts.at(-1)?.task === "deploy" && prompts.at(-1)?.text.includes("Help me open my store.") && !/personal agents/.test(prompts.at(-1)?.text ?? ""), JSON.stringify(prompts.slice(before)));
        await js(`document.querySelector("#task-back")?.click()`);
        await sleep(200);
        await js(`window.__lore.show("store")`);
        const shelf =`(document.querySelector(".shelf[aria-selected=true]")?.textContent ?? "")`;
        check("Inventory files it under Ready to sell, waiting for the store to open", await waitFor(`${shelf}.startsWith("Ready to sell") && document.querySelector("#content").textContent.includes("Ready to sell once your store opens.") && !document.querySelector("#content").textContent.includes("On sale")`), await js(`document.querySelector("#content").textContent`));
        await shot("agents-ready-to-sell");
      } else if (scenario === "today") {
        // APP-214: Today's one next step, stage by stage, each seeded through the CLI and its store.
        const repo = join(__dirname, "../../..");
        const python = (code) => execFileSync("uv", ["run", "python", "-c", `import time\nfrom lore.store import Store\n${code}`], { cwd: repo, env: process.env });
        const lore = (args, input) => execFileSync("uv", ["run", "lore", ...args], { cwd: repo, env: process.env, input });
        // A probe answer that stays fresh for the whole walk: online holding `ids`, or not answering at all.
        const probe = (state, ids) => python(`with Store() as s:\n s.set_setting('node_url', 'https://store.example/mcp')\n s.set_setting('node_live', {'url': 'https://store.example/mcp', 'checked_at': time.time() + 3600, 'live': {'state': '${state}', 'network': 'eip155:84532', 'price_usd': 0.02, 'payout': '0x' + 'a' * 40}, 'ids': ${ids}})`);
        const steps = `document.querySelectorAll("#content .next-step")`;
        const step = `(${steps}[0]?.textContent ?? "")`;
        const today = `document.querySelector("#content").textContent`;
        const headings = `[...document.querySelectorAll("#content .section > .section-head h2")].map((h) => h.textContent)`;
        const reach = async (label) => {
          await js(`window.__lore.event({ type: "changed" })`);
          return waitFor(`${step}.includes(${JSON.stringify(label)})`, 80);
        };
        const action = async () => js(`${steps}[0]?.querySelector("button")?.textContent ?? ""`);
        const title = () => js(`document.querySelector("#title").textContent`);
        const back = () => js(`document.querySelector("#task-back").click()`);
        /** Press the step's button, and wait for the prompt it sends, if any. */
        const press = async () => {
          const before = prompts.length;
          await js(`${steps}[0].querySelector("button").click()`);
          for (let i = 0; i < 40 && prompts.length === before; i++) await sleep(100);
          return prompts.slice(before);
        };
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        // Every render of Today is watched: never more than one next step, at any moment of the walk.
        await js(`window.__steps = 0; new MutationObserver(() => { window.__steps = Math.max(window.__steps, ${steps}.length); }).observe(document.querySelector("#content"), { childList: true, subtree: true }); true`);

        // e: nothing connected and nothing kept.
        check("e: with no agent and no app, the one next step is to connect the AI the owner talks to most", await waitFor(`${step}.includes("Connect the AI you talk to most")`) && await action() === "Connect", await js(step));
        check("…with no Needs you grid and no coding agents named", !(await js(`${headings}.includes("Needs you") || document.querySelector("#content .tiles") !== null`)) && !/Claude Code|Codex/.test(await js(today)), await js(today));
        check("…and How it works offered while nothing is kept", await js(`document.querySelector("#content .how-it-works") !== null`));
        await shot("today-e-connect");
        await js(`[...document.querySelectorAll("#content .how-it-works button")].find((b) => b.textContent === "How it works").click()`);
        check("…which opens the FAQ", await waitFor(`document.querySelector("#title").textContent === "FAQ"`));
        await js(`window.__lore.show("today")`);
        await js(`document.querySelector("#content .how-it-works .dismiss").click()`);
        await js(`window.__lore.show("memories"); window.__lore.show("today")`);
        check("…and once closed it stays closed", await js(`${todayShown} && document.querySelector("#content .how-it-works") === null`));
        // Opened again, so the next stage shows that a first memory alone takes it away.
        await js(`localStorage.removeItem("lore.how-it-works.closed"); window.__lore.show("today"); true`);
        await js(`${steps}[0].querySelector("button").click()`);
        check("…Connect opens Connectors with the Connect an agent sheet", await waitFor(`document.querySelector("#title").textContent === "Connectors" && document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") === "Connect an agent"`), await js(`document.querySelector("dialog.sheet[open]")?.getAttribute("aria-label") ?? "none"`));
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);
        await js(`window.__lore.show("today")`);

        // d: memories, nothing drafted or for sale.
        lore(["capture", "apply", "-"], JSON.stringify([{ title: "Hire management before rapid growth", content: "Add the management layer before the next ten engineers join, not after.", project: "team scaling" }, { title: "Price the first tier low", content: "A low first price gets the first ten buyers; raise it once there are receipts.", project: "pricing" }]));
        check("d: with memories and nothing to sell, the next step is to sell something", await reach("Turn what you know into something to sell") && await action() === "Start", await js(step));
        check("…ahead of connecting an agent, and How it works is gone once something is kept", (await js(`${steps}.length`)) === 1 && await js(`document.querySelector("#content .how-it-works") === null`));
        await shot("today-d-sell");
        const started = await press();
        check("…Start opens the publish thread with one prompt", await waitFor(`document.querySelector("#title").textContent === "Publish from your Lore"`) && started.length === 1 && started[0].task === "publish", JSON.stringify(started));
        await back();
        check("…and while it drafts, Today doesn't ask again: the thread is under Unfinished", await waitFor(`${steps}.length === 0 && ${headings}.includes("Unfinished")`), await js(today));
        finishThread("publish");
        check("…once it finishes with nothing drafted, the step comes back", await reach("Turn what you know into something to sell"), await js(step));

        // c: drafts waiting.
        lore(["publication", "draft", "-"], JSON.stringify([{ title: "Hire management before rapid growth", teaser: "When to add managers in a fast-growing team.", content: "Add the management layer before the next ten engineers join, not after.", kind: "claim", topic: "team scaling", provenance: [1] }, { title: "Price the first tier low", teaser: "How to set a first price.", content: "A low first price gets the first ten buyers; raise it once there are receipts.", kind: "claim", topic: "pricing", provenance: [2] }]));
        await js(`window.__lore.event({ type: "changed" })`);
        check("c: with drafts waiting, the drafts themselves are the next step, with no card pointing at them", await waitFor(`${headings}[0] === "Approve what to sell" && ${steps}.length === 0`, 80), await js(`JSON.stringify(${headings})`));
        const order = await js(`JSON.stringify(${headings})`);
        check("…in the next step's place, said once, with no stats line under it", !order.includes("Next step") && (await js(today)).split("Buyers only ever get what you approve").length === 2 && await js(`document.querySelector("#content .strip") === null`), order);
        await shot("today-c-drafts");

        // b2: a piece approved with no store yet.
        python(`from lore.cli import _staged, _stage\nstaged = _staged()\nwith Store() as s:\n s.add_publication(**staged[0].model_dump())\n s.set_setting('price_usd', 0.02)\n_stage(staged[1:])`);
        check("b2: an approved piece with no store is the next step, ahead of the draft still waiting", await reach("1 approved piece isn't on sale yet") && await action() === "Open your store", await js(step));
        await shot("today-b2-open");
        const opening = await press();
        check("…Open your store opens the store's thread with one prompt", await waitFor(`document.querySelector("#title").textContent === "Open your store"`) && opening.length === 1 && opening[0].task === "deploy" && opening[0].text === "Help me open my store.", JSON.stringify(opening));
        await back();
        check("…and while the store opens, Today offers no next step", await waitFor(`${steps}.length === 0 && ${headings}.includes("Approve what to sell")`) && !(await js(`${today}.includes("Connect the AI you talk to most")`)), await js(today));
        finishThread("deploy");

        // b: the store is open but doesn't hold the piece yet, then a saved price it doesn't charge.
        probe("online", "[]");
        check("b: an approval the store doesn't hold yet is the next step, ahead of the draft still waiting", await reach("1 change isn't live yet") && await action() === "Update store" && (await js(step)).includes("1 approved, not on your store yet"), await js(step));
        python(`with Store() as s:\n s.set_setting('price_usd', 0.75)`);
        check("…a new price counts as a change too", await reach("2 changes aren't live yet") && (await js(step)).includes("Your store still charges $0.02, not $0.75"), await js(step));
        await shot("today-b-update");
        const asked = prompts.length;
        await js(`${steps}[0].querySelector("button").click()`);
        for (let i = 0; i < 40 && !pushes.length; i++) await sleep(100);
        check("…Update store pushes first while a piece isn't on the store, and asks the agent nothing", pushes.length === 1 && prompts.length === asked, `${pushes.length} pushes, ${prompts.length - asked} prompts`);
        const piece = await js(`window.lore.snapshot().then((s) => s.publications.items.find((i) => i.state === "approved").public_id)`);
        probe("online", JSON.stringify([piece]));
        check("…with only the price left, the step is that one change", await reach("1 change isn't live yet") && (await js(step)).includes("Your store still charges $0.02, not $0.75") && !(await js(step)).includes("approved, not on"), await js(step));
        const repricing = await press();
        check("…and Update store redeploys for the price, in the store's thread", await waitFor(`document.querySelector("#title").textContent === "Open your store"`) && repricing.length === 1 && repricing[0].task === "deploy" && /Redeploy my store/.test(repricing[0].text) && pushes.length === 1, JSON.stringify(repricing));
        await back();
        finishThread("deploy");

        // a: the store stops answering.
        probe("unreachable", "None");
        check("a: a store that isn't answering comes first, with one way to fix it", await reach("Your store isn't responding") && await action() === "Fix it" && (await js(`${steps}.length`)) === 1, await js(step));
        await shot("today-a-store");
        await js(`window.__fix = ${steps}[0].querySelector("button"); true`);
        const fixing = await press();
        check("…Fix it opens the store's thread with one prompt", await waitFor(`document.querySelector("#title").textContent === "Open your store"`) && fixing.length === 1 && fixing[0].task === "deploy" && /isn't responding/.test(fixing[0].text), JSON.stringify(fixing));
        await back();
        check("…while the repair runs, Today offers no next step, though the store still isn't answering", await waitFor(`${steps}.length === 0 && document.querySelector("#account").textContent.includes("Offline")`), await js(today));
        const repair = `[...document.querySelectorAll("#content .section")].find((s) => s.querySelector("h2")?.textContent === "Unfinished")?.querySelector(".task-link")`;
        check("…the repair is listed under Unfinished, working", await waitFor(`(${repair}?.textContent ?? "") === "Open your storeWorkingWorking"`), await js(`${repair}?.textContent ?? "none"`));
        const listed = prompts.length;
        await js(`${repair}.click()`);
        check("…and opens back into its thread, sending nothing", await waitFor(`document.querySelector("#title").textContent === "Open your store" && !document.querySelector("#task-back").hidden`) && prompts.length === listed, `${prompts.length - listed} more prompts`);
        await back();
        const sent = prompts.length;
        await js(`window.__fix.click()`);
        await sleep(1500);
        check("…a second Fix it goes back into the repair under way and sends nothing more", prompts.length === sent && await title() === "Open your store", `${prompts.length - sent} more prompts, title ${await title()}`);
        await back();
        finishThread("deploy");
        check("…and once the repair ends with the store still silent, Fix it is offered again", await reach("Your store isn't responding"), await js(step));
        // A repair that fails while the owner is back on Today: the step returns from the turn's end alone, with no other event.
        failNextTurn = true;
        const failing = await press();
        await back();
        check("…a repair under way hides Fix it while it runs", failing.length === 1 && await waitFor(`${steps}.length === 0`), JSON.stringify(failing));
        check("…and when the repair fails, Fix it comes back on its own", await waitFor(`${step}.includes("Your store isn't responding")`, 60), await js(today));

        // f: everything live, nothing drafted, and an app connected: nothing to ask.
        python(`from lore.cli import _staged, _stage\nwith Store() as s:\n for each in _staged(): s.add_publication(**each.model_dump())\n s.set_setting('price_usd', 0.02)\n_stage([])`);
        lore(["sources", "connect", "obsidian", "--json", "--", join(S, "Edge Vault")]);
        const ids = JSON.stringify(JSON.parse(await js(`window.lore.snapshot().then((s) => JSON.stringify(s.publications.items.map((i) => i.public_id)))`)));
        probe("online", ids);
        await js(`window.__lore.event({ type: "changed" })`);
        check("f: with nothing waiting on the owner, Today shows no next step", await waitFor(`!${today}.includes("isn't responding") && ${steps}.length === 0 && snapshot.publications.counts.active === 2 && forSale(snapshot)`, 80), await js(today));
        check("…and a connected app is enough not to be asked to connect", !(await js(`${today}.includes("Connect the AI you talk to most")`)));
        await shot("today-f-nothing");
        check("no moment of the walk showed more than one next step", (await js(`window.__steps`)) === 1, String(await js(`window.__steps`)));
      } else if (scenario === "reading") {
        // AUT-005: connect Granola, and Lore reads the meetings through without being asked.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        await js(`window.__lore.show("connectors")`);
        const granola = `[...[...document.querySelectorAll("#content section")].find((s) => s.querySelector("h2")?.textContent === "Your apps").querySelectorAll(".row")].find((r) => r.querySelector("b").textContent === "Granola")`;
        await waitFor(granola);
        await js(`${granola}.querySelector("button").click()`);
        await waitFor(`document.querySelector("dialog.sheet[open] .btn.primary")?.textContent === "Sign in to Granola"`);
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        check("connecting says Lore is turning the meetings into memories", await waitFor(`document.querySelector("#status").textContent.includes("Lore is turning them into memories now.")`), await js(`document.querySelector("#status").textContent`));
        for (let i = 0; i < 40 && !readings.length; i++) await sleep(250);
        check("…and starts one reading of what came in", readings.length === 1 && readings[0].label === "Granola" && readings[0].item === "meeting" && readings[0].added === 2, JSON.stringify(readings));
        await js(`window.__lore.show("today")`);
        check("Today shows the reading as one quiet row", await waitFor(`document.querySelector("#content").textContent.includes("Reading your Granola meetings…")`));
        check("…and the owner can still type", await js(`!document.querySelector("#capture-input").disabled`));
        const readingLabel = `[...document.querySelectorAll("#content .row b")].find((b) => b.textContent === "Reading your Granola meetings…")`;
        check("…its words shimmering while it reads", await js(`${readingLabel}?.classList.contains("shimmer") && ${animating(readingLabel, "shimmer")}`));
        await shot("reading-today-working");
        await motion(true);
        check("…and standing still, plain to read, under reduced motion", await js(`getComputedStyle(${readingLabel}).animationName === "none" && getComputedStyle(${readingLabel}).color !== "rgba(0, 0, 0, 0)"`));
        await motion(false);
        await js(`window.__lore.show("connectors")`);
        for (let i = 0; i < 60 && !notes.length; i++) await sleep(250);
        check("a finished reading is one Mac notification", notes.length === 1 && notes[0].words.title === "Lore read your Granola meetings" && notes[0].words.body === "2 new memories. 1 looks worth selling.", JSON.stringify(notes.map((n) => n.words)));
        check("…and a red 2 on the dock while the owner is elsewhere", badges.at(-1) === 2, JSON.stringify(badges));
        check("…and the notice that it was reading goes away", await waitFor(`!document.querySelector("#status").textContent.includes("Lore is turning them into memories now.")`), await js(`document.querySelector("#status").textContent`));
        notes[0].handlers.click();
        check("clicking it lands on Today's new memories", await waitFor(`document.querySelector("#content").textContent.includes("Lore read your Granola meetings")`), await js(`document.querySelector("#title").textContent + " | " + document.querySelector("#content").textContent.slice(0, 200)`));
        const card = `[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("New memories"))`;
        check("…folded, its mark Granola's", await js(`!${card}.querySelector(".ready-items") && ${card}.querySelector(".ready-head .mark-stack img.logo")?.src.endsWith("assets/granola.svg")`));
        await js(`${card}.querySelector(".ready-head .task-link").click()`);
        await waitFor(`Boolean(${card}?.querySelector(".ready-items"))`);
        const cardText = await js(`${card}.textContent`);
        check("…opened, each by title", /2 new memories · 1 worth selling/.test(cardText) && cardText.includes("Raise the first price only after ten buyers pay") && cardText.includes("Add the ops management layer before the next ten hires"), cardText);
        check("…work stays private and is never offered for sale", cardText.includes("Work · stays private") && await js(`[...${card}.querySelectorAll(".row")].filter((r) => [...r.querySelectorAll("button")].some((b) => b.textContent === "Draft for sale")).map((r) => r.querySelector("b").textContent).join("|")`) === "Raise the first price only after ten buyers pay");
        check("…in plain words", !/synthes|agent|pipeline|mcp/i.test(cardText), cardText);
        check("…and, from an app rather than an agent, no See them in its header", !(await js(`Boolean(${card}.querySelector(".ready-head button.inline"))`)));
        check("…the card says who once, not each memory again", !/From Granola · /.test(cardText), cardText);
        check("seeing it clears the dock", await (async () => { for (let i = 0; i < 40 && badges.at(-1) !== 0; i++) await sleep(100); return badges.at(-1) === 0; })(), JSON.stringify(badges));
        check("…and nothing on Today shimmers once it has read", await js(`!document.querySelector("#content .shimmer")`));
        await shot("reading-today-ready");
        await js(`window.__lore.show("memories")`);
        check("the memories are in Inventory, grouped under work and personal", await waitFor(`document.querySelector("#content").textContent.includes("Raise the first price only after ten buyers pay")`) && await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("ops management"))?.closest(".inv-group")?.querySelector(".inv-group-head b")?.textContent === "work"`));
        const older = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("An older lesson Lore wrote"))`;
        check("one Lore wrote before it kept who from says so, never a guess", await js(`/Written by Lore · /.test(${older}?.textContent ?? "") && !/From /.test(${older}.textContent) && Boolean(${older}.querySelector(".mark-stack .routine-mark svg rect"))`), await js(`${older}?.textContent ?? ""`));
        // Who wrote them is recorded last, after the banner, so Inventory names them once that lands.
        check("…while the new ones say Granola", await waitFor(`/From Granola · /.test([...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Raise the first price"))?.textContent ?? "")`));
        const granolaHead = `[...document.querySelectorAll("#content .inv-group-head")].find((h) => h.querySelector("b")?.textContent === "Granola")`;
        check("Granola's group is headed by Granola's own mark, not a letter", await js(`${granolaHead}?.querySelector("img.logo")?.src.endsWith("assets/granola.svg") && !${granolaHead}.querySelector(".initial")`), await js(`${granolaHead}?.innerHTML ?? ""`));
        check("a mark Lore doesn't ship is never drawn from a path", await js(`sourceMark({ kind: "app", id: "x", label: "X", mark: "../../elsewhere", at: null }) === STEP_ICONS.connect && sourceMark({ kind: "app", id: "x", label: "X", mark: "constructor", at: null }) === STEP_ICONS.connect`));
        await js(`${older}.scrollIntoView({ block: "center" })`);
        await sleep(300);
        await shot("reading-inventory-from");
        await js(`window.__lore.show("today")`);
        await js(`[...${card}.querySelectorAll("button")].find((b) => b.textContent === "Draft for sale").click()`);
        check("Draft for sale opens the publish thread from that memory", await waitFor(`document.querySelector("#title").textContent === "Publish from your Lore"`) && await waitFor(`document.querySelector("#log").textContent.includes("Raise the first price only after ten buyers pay")`));
        await js(`document.querySelector("#task-back").click()`);
        await waitFor(`${card}`);
        await js(`[...${card}.querySelectorAll("button")].find((b) => b.textContent === "Clear").click()`);
        check("Clear takes the card off Today", await waitFor(`!document.querySelector("#content").textContent.includes("New memories")`));
        check("…and a relaunch would not bring it back", await js(`window.lore.readyRuns().then((runs) => runs.length)`) === 0);
      } else if (scenario === "schedule") {
        // AUT-006: Lore was closed at its reading hour, so opening it reads once, unasked, and says so as a connect does.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        for (let i = 0; i < 60 && !readings.length; i++) await sleep(250);
        check("the launch catches up on the missed hour with one reading", readings.length === 1 && readings[0].label === "Obsidian" && readings[0].added === 1, JSON.stringify(readings));
        for (let i = 0; i < 60 && !notes.length; i++) await sleep(250);
        check("…which lands as the same Mac notification", notes.length === 1 && notes[0].words.title === "Lore read your Obsidian notes" && notes[0].words.body === "2 new memories. 1 looks worth selling.", JSON.stringify(notes.map((n) => n.words)));
        check("…and the same red number on the dock", badges.at(-1) === 2, JSON.stringify(badges));
        await js(`window.__lore.show("today")`);
        check("…and the same New memories card on Today", await waitFor(`document.querySelector("#content").textContent.includes("Lore read your Obsidian notes")`));
        await shot("schedule-today-ready");
        const routines = JSON.parse(execFileSync("uv", ["run", "lore", "automation", "list", "--json"], { cwd: join(__dirname, "../../.."), env: process.env, encoding: "utf8" }));
        const synthesis = routines.find((routine) => routine.id === "synthesis");
        check("the CLI remembers the run and its result, so it is not owed again", synthesis?.due === false && synthesis.result === "1 new note" && synthesis.last_run, JSON.stringify(routines));
        await js(`window.__lore.event({ type: "changed" })`);
        await js(`window.__lore.show("connectors")`);
        const rhythm = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How often Lore reads them"))?.textContent ?? ""`;
        check("Connectors says Lore keeps the rhythm while it is open", await waitFor(`(${rhythm}).includes("Every day at 9 AM, while Lore is open. Last read")`), await js(rhythm));
        check("…in plain words", !/cron|executor|schedul(e|ing) task/i.test(await js(rhythm)), await js(rhythm));
        await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How often Lore reads them")).scrollIntoView()`);
        await sleep(300);
        await shot("schedule-connectors");
      } else if (scenario === "automations") {
        // APP-200: every routine in one list, Lore's own first; pause, retime, run now, add and remove, all kept by the CLI.
        const listed = () => JSON.parse(execFileSync("uv", ["run", "lore", "automation", "list", "--json"], { cwd: join(__dirname, "../../.."), env: process.env, encoding: "utf8" }));
        const mine = () => listed().find((/** @type {Routine} */ routine) => !routine.built_in);
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(todayShown);
        await js(`document.querySelector("nav [data-view=automations]").click()`);
        const rowOf = (/** @type {string} */ name) => `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector("b")?.textContent === ${JSON.stringify(name)})`;
        const SUNDAY = "Every Sunday, remember what I read this week";
        check("the tab lists Lore's own first, then the owner's", await waitFor(`${rowOf(SUNDAY)}`) && await js(`[...document.querySelectorAll("#content .row .t b")].map((b) => b.textContent).join("|")`) === `Read connected apps|Evening check-in|Suggest collections|${SUNDAY}` && await js(`Boolean(document.querySelector("#new-automation"))`), await js(`[...document.querySelectorAll("#content .row .t b")].map((b) => b.textContent).join("|")`));
        const text = await js(`document.querySelector("#content").textContent`);
        const nexts = await js(`[...document.querySelectorAll("#content .row.routine")].map((r) => r.querySelector("[data-next]")?.dataset.next ?? "")`);
        check("…each with when it runs and when it runs next", text.includes("Every day at 9 AM") && text.includes("Every weekday at 6 PM") && text.includes("Every Sunday at 6 PM") && JSON.stringify(nexts) === JSON.stringify(listed().sort((/** @type {Routine} */ x, /** @type {Routine} */ y) => Number(Boolean(y.built_in)) - Number(Boolean(x.built_in))).map((/** @type {Routine} */ routine) => routine.next_run)), JSON.stringify(nexts));
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
        await js(`${rowOf(SUNDAY)}.querySelector(".routine-act[aria-label='Run now']").click()`);
        for (let i = 0; i < 40 && !readings.length; i++) await sleep(250);
        check("Run now hands the owner's sentence to Lore's quiet reading", readings.length === 1 && readings[0].ask === SUNDAY, JSON.stringify(readings));
        check("…and its row says it is running until the reading is done", (await js(`${rowOf(SUNDAY)}.textContent`)).includes("Running now"), await js(`${rowOf(SUNDAY)}.textContent`));
        for (let i = 0; i < 60 && !notes.length; i++) await sleep(250);
        check("…which writes private memories and says so, named by its sentence", notes.length === 1 && notes[0].words.title === `“${SUNDAY}”` && notes[0].words.body === "2 new memories. 1 looks worth selling.", JSON.stringify(notes.map((n) => n.words)));
        check("…and records what it found", await (async () => { for (let i = 0; i < 20 && mine().result !== "2 new memories"; i++) await sleep(250); return mine().result === "2 new memories"; })(), JSON.stringify(mine()));
        check("…then says it is done, once, without a second banner", await waitFor(`document.body.textContent.includes(${JSON.stringify(`“${SUNDAY}” is done · 2 new memories`)})`) && notes.length === 1, JSON.stringify(notes.map((n) => n.words)));
        await js(`window.__lore.show("today")`);
        // APP-229 folded Today's new memories into one card: the sentence and the clock sit on its head, the memories under it once opened.
        const card = `[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("New memories"))`;
        check("Today names it by its sentence alone", await waitFor(`${card}?.querySelector(".ready-head .t b")?.textContent === ${JSON.stringify(`“${SUNDAY}”`)} && ${card}.querySelector(".ready-head .t span")?.textContent.startsWith("2 new memories")`), await js(`${card}?.querySelector(".ready-head")?.textContent`));
        check("…folded, its mark the clock", await js(`!${card}.querySelector(".ready-items") && Boolean(${card}.querySelector(".ready-head .mark-stack .routine-mark svg circle"))`));
        await js(`${card}.querySelector(".ready-head .task-link").click()`);
        await waitFor(`Boolean(${card}?.querySelector(".ready-items"))`);
        check("…opened, the two memories it wrote, each without repeating where it came from", await js(`(${card}.querySelectorAll(".ready-items .row").length === 2) && [...${card}.querySelectorAll(".ready-items .row")].every((r) => !r.textContent.includes("From "))`), await js(`[...${card}.querySelectorAll(".ready-items .row")].map((r) => r.textContent).join(" | ")`));
        await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("New memories"))?.scrollIntoView()`);
        await sleep(300);
        await shot("automations-today-owner-routine");
        await js(`document.querySelector("nav [data-view=automations]").click()`);
        check("the tab carries no dot of its own", await js(`!document.querySelector("nav [data-view=automations] .new-dot")`));
        // The owner pressed Run now and went elsewhere: a run that finds nothing still says it finished.
        const told = notes.length;
        window.hide();
        await js(`${rowOf("Read connected apps")}.querySelector(".routine-act[aria-label='Run now']").click()`);
        for (let i = 0; i < 40 && notes.length === told; i++) await sleep(250);
        const away = notes.slice(told).map((n) => n.words);
        check("Run now away from Lore ends with one banner saying it is done", away.length === 1 && away[0].title === "“Read connected apps” is done" && away[0].body === "Nothing new", JSON.stringify(away));
        // Back on screen without taking the keyboard from whoever is at this Mac.
        window.showInactive();
        // Paused for days, then resumed: it waits for its next hour instead of running at once.
        const repo = join(__dirname, "../../..");
        const python = (/** @type {string} */ code) => execFileSync("uv", ["run", "python", "-c", `from datetime import datetime, timedelta, timezone\nfrom lore import automation\nnow = datetime.now(timezone.utc)\n${code}`], { cwd: repo, env: process.env, encoding: "utf8" });
        const checkInOf = () => listed().find((/** @type {Routine} */ r) => r.id === "checkin");
        python("automation.Routines().save('checkin', last_run=now - timedelta(days=4), since=now - timedelta(days=4))");
        await js(`window.__lore.event({ type: "changed" })`);
        await waitFor(`${rowOf("Evening check-in")}?.querySelector(".switch").getAttribute("aria-checked") === "false"`);
        await js(`${rowOf("Evening check-in")}.querySelector(".switch").click()`);
        await waitFor(`${rowOf("Evening check-in")}?.querySelector(".switch").getAttribute("aria-checked") === "true"`);
        await sleep(2500);
        check("resuming a check-in paused for days never runs it at once", !checkInOf().due && !checkInOf().paused && Date.parse(checkInOf().next_run) > Date.now() && checkInOf().last_run.startsWith(new Date(Date.now() - 4 * 86400_000).toISOString().slice(0, 10)), JSON.stringify(checkInOf()));
        // Moved to an hour that already passed today: it waits for tomorrow's.
        const earlier = (new Date().getHours() + 23) % 24;
        await js(`${rowOf("Evening check-in")}.querySelector("[aria-label='Change time']").click()`);
        await waitFor(`Boolean(document.querySelector("dialog.form-sheet[open] select"))`);
        await js(`{ const [cadence, , hour] = document.querySelectorAll("dialog.sheet[open] select"); cadence.value = "daily"; cadence.dispatchEvent(new Event("change")); hour.value = "${earlier}"; }`);
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        await waitFor(`${rowOf("Evening check-in")}?.textContent.includes("Every day at")`);
        await sleep(2500);
        check("…and moving it to an hour already past waits for tomorrow", checkInOf().hour === earlier && !checkInOf().due && Date.parse(checkInOf().next_run) - Date.now() > 20 * 60 * 60_000 && checkInOf().last_run.startsWith(new Date(Date.now() - 4 * 86400_000).toISOString().slice(0, 10)), JSON.stringify(checkInOf()));
        await js(`document.querySelector("#new-automation").click()`);
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
        await js(`document.querySelector("#new-automation").click()`);
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
        await js(`window.__lore.show("connectors")`);
        const rhythm = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How often Lore reads them"))?.textContent ?? ""`;
        check("pausing the reading shows on Connectors too", await waitFor(`(${rhythm}).includes("paused")`), await js(rhythm));
        await js(`window.__lore.show("automations")`);
        await sleep(400);
        await shot("automations-after");
        // APP-246: a suggested collection reads as its name and what's in it, and Review shows only those memories.
        const kept = await js(`window.lore.snapshot().then((s) => s.library.items.filter((m) => m.status === "private").map((m) => ({ id: m.id, title: m.title })))`);
        writeFileSync(join(process.env.LORE_DESKTOP_USER_DATA ?? "", "collection-suggestions.json"), JSON.stringify([{ at: new Date().toISOString(), title: "Pricing lessons", memories: [kept[0].id], from: "Suggest collections" }]));
        await js(`window.__lore.show("today")`);
        await js(`window.__lore.event({ type: "changed" })`);
        const suggested = `[...document.querySelectorAll("#content .row.suggestion")].find((r) => r.querySelector("b")?.textContent === "Pricing lessons")`;
        check("a suggested collection says what's in it under Inventory's mark", await waitFor(`${suggested}?.querySelector(".t span")?.textContent === ${JSON.stringify(`1 memory · ${kept[0].title}`)}`) && await js(`${suggested}.querySelector(".routine-mark svg")?.innerHTML === document.querySelector("nav [data-view=inventory] svg").innerHTML && Boolean(${suggested}.querySelector(".dismiss[aria-label='Dismiss Pricing lessons']"))`), await js(`${suggested}?.textContent`));
        await js(`${suggested}.closest(".section").scrollIntoView()`);
        await sleep(300);
        await shot("automations-suggested-collection");
        await js(`[...${suggested}.querySelectorAll(".btn")].find((b) => b.textContent === "Review").click()`);
        check("…Review shows only its memories, ticked, with no search", await waitFor(`document.querySelectorAll("#content .pick").length === 1`) && await js(`document.querySelector("#content .pick input").checked && !document.querySelector("#content .pick-find") && document.querySelector("#content .wizard-lead").textContent === "Lore picked this memory. Untick any that don't belong."`), await js(`document.querySelector("#content").textContent`));
        await shot("automations-suggestion-review");
        await js(`[...document.querySelectorAll("#content .pick-foot .btn")].find((b) => b.textContent === "Choose from all memories").click()`);
        check("…and every memory is one tap away, the suggestion's still ticked", await waitFor(`Boolean(document.querySelector("#content .pick-find"))`) && await js(`document.querySelectorAll("#content .pick").length === ${kept.length} && document.querySelectorAll("#content .pick input:checked").length === 1`), await js(`document.querySelectorAll("#content .pick").length`));
        // Stepping away keeps the suggestion; only putting its memories in clears it from Today.
        await js(`[...document.querySelectorAll("#content .pick-foot .btn")].find((b) => b.textContent === "Cancel").click()`);
        await js(`window.__lore.show("today")`);
        check("…Cancel leaves the suggestion on Today to come back to", await waitFor(`Boolean(${suggested})`) && await js(`window.lore.suggestions().then((all) => all.length === 1)`));
        await js(`[...${suggested}.querySelectorAll(".btn")].find((b) => b.textContent === "Review").click()`);
        await waitFor(`document.querySelectorAll("#content .pick").length === 1`);
        await js(`[...document.querySelectorAll("#content .pick-foot .btn")].find((b) => b.textContent === "Continue").click()`);
        check("…and Continue puts its memories in, then clears it", await waitFor(`Boolean(document.querySelector("#content .collection-name"))`) && await (async () => { for (let i = 0; i < 20; i++) { if (await js(`window.lore.suggestions().then((all) => all.length === 0)`)) return true; await sleep(250); } return false; })());
      } else if (scenario === "checkin" || scenario === "quiet") {
        // AUT-008: the check-in whose hour passed an hour ago runs at launch, on what was read in since it last judged.
        const repo = join(__dirname, "../../..");
        const loreCli = (/** @type {string[]} */ args) => execFileSync("uv", ["run", "lore", ...args], { cwd: repo, env: process.env, encoding: "utf8" });
        const python = (/** @type {string} */ code) => execFileSync("uv", ["run", "python", "-c", `from datetime import datetime, timedelta, timezone\nfrom lore import automation\nnow = datetime.now(timezone.utc)\n${code}`], { cwd: repo, env: process.env, encoding: "utf8" });
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
        for (let i = 0; i < 60 && !checkIns.length; i++) await sleep(250);
        check("the launch looks over the one item read in since, and reads nothing itself", checkIns.length === 1 && checkIns[0].items.length === 1 && checkIns[0].items[0].title === "Pushed back on the Acme pricing call" && !readings.length, JSON.stringify({ checkIns, readings }));
        const card = `[...document.querySelectorAll("#content .section")].find((s) => s.querySelector("h2, .eyebrow, header")?.textContent.trim().toLowerCase() === "check in")`;
        const asking = (/** @type {{words: {title: string}}} */ note) => note.words.title === "Five minutes on today?";
        await js(`window.__lore.show("today")`);
        for (let i = 0; i < 60 && !checkin().result; i++) await sleep(250);
        await js(`window.__lore.event({ type: "changed" })`);
        await sleep(800);
        if (scenario === "quiet") {
          check("a quiet day posts no check-in notification", !notes.some(asking), JSON.stringify(notes.map((n) => n.words)));
          check("…puts nothing on Today", !(await js(`Boolean(${card})`)) && !(await js(`document.querySelector("#content").textContent.includes("Five minutes")`)));
          check("…and leaves the dock alone", !badges.some((count) => count > 0), JSON.stringify(badges));
          check("…and says so in the routine's last result", checkin().result === "Nothing new to ask about", checkin().result);
          await shot("checkin-quiet-today");
          // Closed at the check-in's hour and opened five hours later: it is recorded as missed and asks nothing.
          const late = new Date(Date.now() - 5 * 60 * 60_000).getHours();
          python(`automation.Routines().save('checkin', hour=${late}, last_run=now - timedelta(days=1), since=now - timedelta(days=2))`);
          require("electron").powerMonitor.emit("resume");
          for (let i = 0; i < 40 && !checkin().result.startsWith("Skipped"); i++) await sleep(250);
          const clock = `${late % 12 || 12} ${late < 12 ? "AM" : "PM"}`;
          const skipped = new Date(Date.now() - 5 * 60 * 60_000).toLocaleDateString("en-US", { weekday: "long" });
          check("a check-in missed by hours is recorded as missed, and never asks late", checkin().result === `Skipped ${skipped}: Lore wasn't open at ${clock}` && checkIns.length === 1 && !notes.some(asking), `${checkin().result} · ${checkIns.length} looks`);
        } else {
          const note = notes.find(asking);
          check("a day worth asking about is one notification naming the thing", notes.filter(asking).length === 1 && note?.words.body === "You held the price on the Acme call. What made you hold firm?", JSON.stringify(notes.map((n) => n.words)));
          check("…a Check in card leads Today", await waitFor(`${card} && document.querySelector("#content .section") === ${card}`), await js(`[...document.querySelectorAll("#content .section")].map((s) => s.textContent.slice(0, 40)).join(" | ")`));
          check("…and the dock keeps a red 1 for it", badges.at(-1) === 1, JSON.stringify(badges));
          check("…recorded as the routine's last result", checkin().result === "Asked about 1 thing", checkin().result);
          check("…and the thread is not listed twice", !(await js(`document.querySelector("#content").textContent.includes("Unfinished")`)));
          await shot("checkin-today");
          note?.handlers.click();
          check("the notification opens a thread with the question already asked", await waitFor(`document.querySelector("#title").textContent === "Evening check-in"`) && await waitFor(`document.querySelector("#log").textContent.includes("What made you hold firm?")`));
          check("…and the owner can answer straight away", await js(`!document.querySelector("#capture-input").disabled`) && (await js(`document.querySelector("#eyebrow")?.textContent ?? ""`)) === "Waiting for you · Five minutes on today", await js(`document.querySelector("#eyebrow")?.textContent ?? ""`));
          await shot("checkin-thread");
          await js(`document.querySelector("#task-back").click()`);
          await waitFor(card);
          // Run now later the same day leaves today's questions where they are.
          await js(`document.querySelector("nav [data-view=automations]").click()`);
          const checkInRow = `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector("b")?.textContent === "Evening check-in")`;
          await waitFor(checkInRow);
          const before = checkin().last_run;
          await js(`${checkInRow}.querySelector(".routine-act[aria-label='Run now']").click()`);
          for (let i = 0; i < 40 && checkin().last_run === before; i++) await sleep(250);
          await sleep(1500);
          await js(`window.__lore.show("today")`);
          check("Run now on the same day keeps today's card, its questions and the dock's 1", await waitFor(card) && badges.at(-1) === 1 && (await js(`window.lore.checkIn()`))?.questions[0].question === "You held the price on the Acme call. What made you hold firm?" && checkin().result === "Asked about 1 thing" && checkIns.length === 1 && checkin().last_run !== before, `${JSON.stringify(badges)} · ${checkin().result} · ${checkIns.length} looks`);
          // The next evening brings in something new; yesterday's unanswered questions give way to today's.
          nextDay();
          writeFileSync(join(S, "Edge Vault", "three.md"), "# Dropped the Globex renewal\n\nWalked away from the renewal; no reason written down.\n");
          loreCli(["sources", "read"]);
          require("electron").powerMonitor.emit("resume");
          for (let i = 0; i < 80 && notes.filter(asking).length < 2; i++) await sleep(250);
          const second = notes.filter(asking)[1];
          check("the next day's check-in asks about the next day's item", checkIns.length === 2 && checkIns[1].items.map((item) => item.title).join() === "Dropped the Globex renewal" && second?.words.body === "What made you walk away from the Globex renewal?", JSON.stringify({ items: checkIns[1]?.items, note: second?.words }));
          second?.handlers.click();
          const log = `document.querySelector("#log").textContent`;
          check("…and its notification opens a new thread with only that day's question", await waitFor(`${log}.includes("walk away from the Globex renewal?")`) && !(await js(`${log}.includes("What made you hold firm?") || ${log}.includes("Started over")`)), await js(log));
          await shot("checkin-thread-day-two");
          await js(`document.querySelector("#task-back").click()`);
          await waitFor(card);
          await js(`[...${card}.querySelectorAll("button")].find((b) => b.textContent === "Not today").click()`);
          check("Not today takes the card away and clears the dock", await waitFor(`!(${card})`) && await (async () => { for (let i = 0; i < 40 && badges.at(-1) !== 0; i++) await sleep(100); return badges.at(-1) === 0; })(), JSON.stringify(badges));
          check("…for good, and its thread with it", await js(`window.lore.checkIn()`) === null && !(await js(`window.lore.tasks().then((all) => all.some((t) => t.kind === "evening"))`)));
        }
      } else if (scenario === "sales") {
        // MON-037: a new sale is a Mac notification and shows on Today; old sales never are.
        const { existsSync, readFileSync } = require("node:fs");
        const piece = readFileSync(join(S, "piece"), "utf8");
        const sale = (tx, sold_at, network = "stripe", price_usd = 3) => ({ kind: "publication", item_id: piece, title: "Live demos beat cold decks", price_usd, network, payer: "", tx, sold_at });
        const ledger = JSON.parse(readFileSync(join(S, "sales.json"), "utf8"));
        const arrive = async (...fresh) => {
          ledger.unshift(...fresh.reverse());
          writeFileSync(join(S, "sales.json"), JSON.stringify(ledger));
          const before = notes.length;
          app.emit("browser-window-focus");
          for (let i = 0; i < 60 && notes.length === before; i++) await sleep(250);
        };
        await js(`window.__lore.signIn()`);
        // APP-219: Today is what came in and the one thing to do next; sales, runs and store facts live elsewhere.
        await waitFor(`${todayShown} && Array.isArray(sales) && sales.length === 1`);
        const today = await js(`document.querySelector("#content").textContent`);
        check("Today carries no Earned, no Recent runs and no stats line", !/Earned|earned|Recent runs/.test(today) && !today.includes("Live demos beat cold decks") && await js(`document.querySelector("#content .strip") === null`), today);
        check("…and a thread left days ago is not Unfinished", !today.includes("Unfinished") && !today.includes("Capture a memory"), today);
        for (let i = 0; i < 60 && !existsSync(join(process.env.LORE_DESKTOP_USER_DATA ?? "", "sales-seen.json")); i++) await sleep(250);
        check("a sale from before is never announced", notes.length === 0, String(notes.length));
        await sleep(300);
        await shot("sales-today-top");
        await js(`document.querySelector("#main").scrollTop = document.querySelector("#main").scrollHeight`);
        await sleep(300);
        await shot("sales-today");
        await js(`window.__lore.show("store")`);
        check("Inventory shows what the store has earned, and the sale", await waitFor(`document.querySelector("#content").textContent.includes("1 sale · $3.00") && document.querySelector("#content").textContent.includes("by card")`), await js(`document.querySelector("#content").textContent`));
        check("…each sale's receipt is a word, not a glyph", await js(`[...document.querySelectorAll("#content a.receipt")].map((a) => a.textContent + " " + a.href).join(",")`) === "Receipt https://dashboard.stripe.com/payments/pi_old" && !(await js(`[...document.querySelectorAll("#content a.receipt")].some((a) => a.closest(".row").textContent.includes("↗"))`)));
        await arrive(sale("pi_new", "2026-10-04T18:00:00Z"));
        check("a new sale is a Mac notification", notes.length === 1 && notes[0].words.title === "You sold a piece" && notes[0].words.body === "Live demos beat cold decks · $3.00 by card", JSON.stringify(notes.map((n) => n.words)));
        check("…and Inventory counts it", await waitFor(`document.querySelector("#content").textContent.includes("2 sales · $6.00")`));
        await arrive(...[1, 2, 3, 4, 5].map((n) => sale(`0xtx${n}`, `2026-10-04T19:0${n}:00Z`, "eip155:8453", 0.5)));
        check("many at once are one notification", notes.length === 2 && notes[1].words.title === "You sold 5 pieces" && notes[1].words.body === "$2.50", JSON.stringify(notes.map((n) => n.words)));
        app.emit("browser-window-focus");
        await sleep(2000);
        check("a sale is announced once", notes.length === 2, String(notes.length));
        notes[1].handlers.click();
        check("clicking it opens Inventory, on sale", await waitFor(`document.querySelector("#title").textContent === "Inventory" && document.querySelector(".shelf[aria-selected=true]")?.textContent.startsWith("On sale")`));
        check("For Sale shows each piece's page views and how each sale was paid", await waitFor(`document.querySelector("#content").textContent.includes("42 views") && document.querySelector("#content").textContent.includes("by an agent")`));
        check("an unreachable store offers no price link it can't act on", await js(`document.querySelector("#content .store-bar").textContent.includes("isn't responding") && !document.querySelector("#content .store-bar").textContent.includes("Set a price")`), await js(`document.querySelector("#content .store-bar").textContent`));
        // APP-211: sale amounts read in the UI font with even figures, like the store card.
        const amounts = `[...document.querySelectorAll("#content *")].filter((n) => !n.children.length && /\\$\\d/.test(n.textContent))`;
        check("no sale amount is monospace", await js(`${amounts}.length > 2 && ${amounts}.every((n) => !/mono/i.test(getComputedStyle(n).fontFamily) && getComputedStyle(n).fontVariantNumeric.includes("tabular-nums"))`), await js(`${amounts}.map((n) => n.textContent + " " + getComputedStyle(n).fontFamily + " " + getComputedStyle(n).fontVariantNumeric).join(" | ")`));
        await js(`[...document.querySelectorAll("#content h2")].find((h) => /sales/i.test(h.textContent))?.scrollIntoView({ block: "start" })`);
        await sleep(200);
        await shot("sales-list");
        await js(`document.querySelector("#main").scrollTop = 0`);
        await shot("sales-for-sale");
        await js(`window.__lore.show("settings")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Activity")`);
        const runs = await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Activity")).textContent`);
        check("the same store update again and again is one row", runs.split("13 publications on your store").length === 2 && runs.includes("4 times"), runs);
        check("an agent's cost is never shown", !runs.includes("$"), runs);
        check("a run that stopped days ago is history, not a way back in", runs.includes("What to Sell Today") && !(await js(`[...document.querySelectorAll("#content .task-link")].some((b) => b.textContent.includes("What to Sell Today"))`)), runs);
        await js(`[...document.querySelectorAll("#content h2")].find((h) => h.textContent === "Activity")?.scrollIntoView({ block: "start" })`);
        await sleep(200);
        await shot("sales-activity");
      } else if (scenario === "cards") {
        // XC-039: Settings takes an owner from "Get paid to your bank" to card payments on, with no Stripe key on this Mac.
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Approve what to sell")`);
        await js(`window.lore.setPrice(3)`);
        await js(`window.__lore.show("settings")`);
        const cardsRow = `[...document.querySelectorAll("#content .way")].find((r) => r.textContent.startsWith("By card"))`;
        const press = (label) => js(`[...${cardsRow}.querySelectorAll("button")].find((b) => b.textContent === ${JSON.stringify(label)}).click()`);
        check("Settings offers to get paid to the bank", await waitFor(`${cardsRow}?.textContent.includes("Get paid to your bank")`));
        await shot("cards-offer");
        await press("Get paid to your bank");
        for (let i = 0; i < 40 && !opened.length; i++) await sleep(250);
        check("Stripe's form opens in the browser, through Lore's checkout", /\/onboard\?account=acct_1EdgeSeller&token=a{64}$/.test(opened[0] ?? ""), opened[0]);
        check("while Stripe needs more, the row says so and offers the form again", await waitFor(`${cardsRow}?.textContent.includes("Needs you") && ${cardsRow}.textContent.includes("Finish with Stripe")`));
        await shot("cards-waiting");
        await press("Finish with Stripe");
        for (let i = 0; i < 40 && opened.length < 2; i++) await sleep(250);
        check("finishing later reopens the form for the same account", checkoutCalls.length === 1 && opened[1] === opened[0], `${checkoutCalls.length} accounts opened`);
        stripeChecking = true;
        await js(`window.dispatchEvent(new Event("focus"))`);
        check("while Stripe verifies, the row says it is checking, with nothing for the owner to do", await waitFor(`${cardsRow}?.textContent.includes("Stripe is checking your details") && !${cardsRow}.querySelector("button")`));
        check("…and the notice to finish the form clears itself", await js(`!document.querySelector("#status").textContent.includes("Finish with Stripe in your browser")`));
        // Stripe clears while the price is under its minimum: said once, on the price row; the card line only says what to do.
        await js(`window.lore.setPrice(0.25)`);
        stripeCleared = true;
        stripeChecking = false;
        await js(`window.__lore.event({ type: "changed" })`);
        const priceRow = `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector(".t b")?.textContent === "Price")`;
        check("a price under the card minimum warns on the price row, once", await waitFor(`${priceRow}?.textContent.includes("Card payments need at least $0.50") && (document.querySelector("#content").textContent.match(/\\$0\\.50/g) ?? []).length === 1 && ${cardsRow}.textContent.includes("once you raise your price") && !${cardsRow}.querySelector(".pill")`, 60));
        await shot("cards-price-warning");
        // Raising the price leaves nothing for the owner to decide, so cards come on by themselves.
        await js(`window.lore.setPrice(3)`);
        await js(`window.__lore.event({ type: "changed" })`);
        await waitFor(`!${priceRow}?.textContent.includes("Card payments need")`);
        check("once Stripe has cleared and the price can be charged, cards come on by themselves", await waitFor(`${cardsRow}?.textContent.includes("Turn off")`, 60));
        check("cards are on, with a way to turn them off", await waitFor(`${cardsRow}?.textContent.includes("Turn off")`));
        check("…into the account Stripe cleared", await js(`window.lore.cardStatus().then((c) => c.account)`) === "acct_1EdgeSeller");
        await shot("cards-on");
      } else {
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Approve what to sell")`);
        check("two drafts to approve", await js(`document.querySelectorAll("#content .draft-title").length`) === 2);

        // Fix 2: an edit survives the agent's next "changed" event (fires on every bash call).
        await js(`const t = document.querySelector("#content .draft-title"); t.value = "Edited by the owner"; t.dispatchEvent(new Event("input"));`);
        await js(`window.__lore.event({ type: "changed" })`);
        await sleep(1500);
        check("approval edit survives a re-render", await js(`document.querySelector("#content .draft-title").value`) === "Edited by the owner");
        await js(`window.__lore.event({ type: "changed" }); window.__lore.event({ type: "changed" })`);
        await sleep(1500);
        check("…and repeated ones", await js(`document.querySelector("#content .draft-title").value`) === "Edited by the owner");

        // Fix 3: Enter in a memory card's title moves to the text instead of keeping the memory.
        await js(`window.__lore.preview({ type: "memories", id: "preview-1", task: null, entries: [{ title: "A title", content: "Some content", project: "p" }] })`);
        await js(`document.querySelector("#request .draft-title").focus()`);
        await key("keyDown", "Return"); await key("char", "Return"); await key("keyUp", "Return");
        await sleep(200);
        check("card is still up after Enter in title", await js(`Boolean(document.querySelector("#request form"))`));
        check("focus moved to the content field", await js(`document.activeElement?.tagName`) === "TEXTAREA");
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
        await sleep(200);
        check("Open goes through the window-open handler", await js(`window.__opened`) === "https://portal.cdp.coinbase.com/products/faucet");
        check("stage two keeps the task heading and swaps the buttons", await js(`document.querySelector("#request .q").textContent`) === "Fund the test buyer" && await buttons() === "I need help|Done");
        check("the card keeps its size between stages", await js(`document.querySelector("#request form").offsetHeight`) === before);
        await js(`document.querySelector("#request").scrollIntoView({ block: "center" }); true`);
        await shot("open-stage-two");
        await js(`document.querySelector("#request form").requestSubmit()`);
        await sleep(200);
        check("Done closes the card and echoes the owner", !(await js(`Boolean(document.querySelector("#request form"))`)) && await js(`document.querySelector("#log").textContent.endsWith("Done")`));
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
        await sleep(100);
        check("a recovery phrase is refused before it reaches the agent", await js(`Boolean(document.querySelector("#request form"))`));
        await js(`document.querySelectorAll("#request .other-answer")[1].value = "0x0c270534cfcecc9224edb903ef5dd70410d08166"; document.querySelector("#request form").requestSubmit()`);
        await sleep(200);
        check("the echo labels and shortens the address", await js(`document.querySelector("#log").textContent.endsWith("$0.01 · Payout: 0x0c27…8166")`));
        await js(`window.__lore.event({ type: "message", task: "capture", text: "Ready." })`);
        check("owner turns are right-aligned bubbles while Lore stays open", await js(`(() => { const owner = document.querySelector("#log .line.owner"); const bubble = owner?.querySelector("p"); const lore = document.querySelector("#log .line:not(.owner) .md"); return Boolean(owner && bubble && lore) && Math.abs(bubble.getBoundingClientRect().right - owner.getBoundingClientRect().right) < 1 && bubble.getBoundingClientRect().left > owner.getBoundingClientRect().left + 64 && !owner.querySelector(".mark, .you") && getComputedStyle(bubble).backgroundColor !== "rgba(0, 0, 0, 0)" && getComputedStyle(lore).backgroundColor === "rgba(0, 0, 0, 0)"; })()`));
        check("…and a screen reader hears who said each line", await js(`[...document.querySelectorAll("#log > .line:not(.thinking)")].every((line) => line.querySelector(":scope > .sr-only")?.textContent === (line.classList.contains("owner") ? "You: " : "Lore: "))`));
        await shot("conversation-bubble");
        const room = `(() => { const main = document.querySelector("#main"); return parseFloat(getComputedStyle(main).scrollPaddingBottom) - document.querySelector("#composer").offsetHeight; })()`;
        await js(`{ const field = document.querySelector("#capture-input"); field.value = "one\\ntwo\\nthree\\nfour\\nfive\\nsix"; field.dispatchEvent(new Event("input")); }`);
        check("a thread keeps what it scrolls to clear of the composer as the composer grows", await waitFor(`document.querySelector("#composer").offsetHeight > 100 && ${room} === 34`), String(await js(room)));
        await js(`{ const field = document.querySelector("#capture-input"); field.value = ""; field.dispatchEvent(new Event("input")); }`);
        await js(`window.__lore.event({ type: "working", task: "capture", active: true }); window.__lore.event({ type: "message", task: "capture", text: "I'll check the store is serving the new price." })`);
        await sleep(100);
        check("an open turn ends in a shimmering line saying what Lore is doing", await js(`(() => { const last = document.querySelector("#log").lastElementChild; return last?.classList.contains("thinking") && last.querySelector(".shimmer")?.textContent === "Reading this…" && last.textContent === "Reading this…"; })()`) && await js(animating(`document.querySelector("#log .thinking .shimmer")`, "shimmer")));
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Setting up your store…", status: true })`);
        check("a tool's status relabels the bubble instead of replacing what Lore said", await js(`document.querySelector("#log .thinking").textContent`) === "Setting up your store…" && /new price/.test(await js(`document.querySelector("#log").textContent`)));
        await shot("thinking-bubble");
        // APP-222: the agent's tool calls, as steps in the owner's words.
        const stepEvent = (id, kind) => js(`window.__lore.event(${JSON.stringify({ type: "step", task: "capture", id, ...(kind ? { kind } : { done: true }) })})`);
        await stepEvent("s1", "read-memory");
        check("a step that starts takes the working line's place, shimmering, in plain words", await js(`(() => { const rows = [...document.querySelectorAll("#log .line.steps .step")]; return !document.querySelector("#log .thinking") && rows.length === 1 && rows[0].textContent === "Read 1 memory" && Boolean(rows[0].querySelector(".shimmer")); })()`), await js(`document.querySelector("#log .line.steps")?.textContent ?? ""`));
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
        // Two frames of the sweep, a moment apart, to show it moves.
        writeFileSync(join(S, "shimmer-1.png"), (await window.webContents.capturePage()).toPNG());
        await sleep(450);
        writeFileSync(join(S, "shimmer-2.png"), (await window.webContents.capturePage()).toPNG());
        const sweep = `(() => { const n = document.querySelector("#log .shimmer"); return [n.getAnimations()[0]?.currentTime ?? null, getComputedStyle(n).backgroundPosition]; })()`;
        const [time, light] = await js(sweep);
        await sleep(300);
        const [later, moved] = await js(sweep);
        check("the shimmer sweeps: its animation runs on, and the light moves", await js(animating(`document.querySelector("#log .shimmer")`, "shimmer")) && typeof time === "number" && later > time && light !== moved, `${time} → ${later}, ${light} → ${moved}`);
        await stepEvent("s3");
        // Words ink in as the reply streams, and only the new ones.
        const inks = `[...document.querySelectorAll("#log .ink")].map((w) => w.textContent).join(" ")`;
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Your store is serving the new price" })`);
        check("a streaming reply's words ink in as they arrive", await js(inks) === "Your store is serving the new price", await js(inks));
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
        check("…which opens on click, over 200ms", await js(`${fold}.classList.contains("open") && ${fold}.querySelector(".steps-sum").getAttribute("aria-expanded") === "true" && getComputedStyle(${fold}.querySelector(".steps-fold")).transitionDuration.startsWith("0.2s")`), await js(`getComputedStyle(${fold}.querySelector(".steps-fold")).transitionDuration`));
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
        await sleep(200);
        check("a card waiting in another thread replaces the composer with a row that opens it", await js(`document.querySelector("#composer").hidden`) && await js(`document.querySelector(".composer-wait").textContent`) === "Lore is waiting on you in Open your store.Open");
        await js(`document.querySelector(".composer-wait button").click()`);
        await sleep(300);
        check("Open lands in the waiting thread with its card", await js(`document.querySelector("#title").textContent`) === "Open your store" && await js(`Boolean(document.querySelector("#request form"))`));
        await js(`document.querySelector("#task-back").click()`);
        await sleep(200);
        await js(`window.__lore.event({ type: "dismiss", id: "preview-wait" }); window.__lore.event({ type: "working", task: "deploy", active: false })`);
        await sleep(200);
        await js(`window.__lore.preview({ type: "open", id: "preview-open-2", task: null, title: "See the payment land", url: "https://sepolia.basescan.org/address/0x1", note: "Token Transfers shows it." })`);
        await js(`document.querySelector("#request .actions button").click()`);
        await sleep(200);
        check("Not now closes the card and echoes the owner", !(await js(`Boolean(document.querySelector("#request form"))`)) && await js(`document.querySelector("#log").textContent.endsWith("Not now")`));

        // Fix 1, seller: approve the last draft with no store. The confirmation must be visible on the Today root.
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
        await sleep(200);
        check("each tab opens at its top, not where the last one was scrolled", await js(`document.querySelector("#main").scrollTop`) === 0);
        await js(`window.__lore.show("today")`);
        await sleep(200);

        // Ledger: with no store there is nothing to read, and the section says so without a probe.
        await js(`window.__lore.show("store")`);
        await sleep(800);
        const sales = await js(`document.querySelector("#content").textContent`);
        check("Sales is empty without a store", sales.includes("No sales yet."), sales.slice(-160));
        await shot("store");

        // Fix 1, technical: a failing CLI call on Memories surfaces as an attention notice instead of vanishing.
        await js(`window.__lore.show("memories")`);
        await waitFor(`document.querySelectorAll("#content .task-link").length >= 1`);
        // Focus first, as a real click or Enter would; a synthetic click() leaves focus where it was.
        await js(`const link = document.querySelector("#content .task-link"); link.focus(); link.click();`);
        await waitFor(`document.querySelector(".sheet")`);
        check("memory actions: Draft for sale up front, Edit and More as labelled icons, Rename and Delete in the menu", await js(`(() => { const sheet = document.querySelector(".sheet"); const icons = [...sheet.querySelectorAll(".sheet-actions .icon-btn")].map((b) => b.getAttribute("aria-label")); const items = [...sheet.querySelectorAll(".sheet-menu [role=menuitem]")].map((b) => b.textContent); return sheet.querySelector(".sheet-actions .btn.primary")?.textContent === "Draft for sale" && icons.join() === "Edit,More" && items.join() === "Rename,Delete" && sheet.querySelector(".sheet-menu .danger")?.textContent === "Delete"; })()`));
        await shot("memory-actions");
        // APP-096: a native modal holds focus, closes on Escape, and hands focus back to the row that opened it.
        check("the sheet is an open native dialog with focus inside", await js(`document.querySelector("dialog.sheet")?.open === true && document.querySelector("dialog.sheet").contains(document.activeElement)`));
        for (let i = 0; i < 6; i++) await key("keyDown", "Tab");
        check("Tab stays inside the open sheet", await js(`document.querySelector("dialog.sheet").contains(document.activeElement)`), await js(`document.activeElement.outerHTML.slice(0, 80)`));
        await key("keyDown", "Escape");
        await sleep(200);
        check("Escape closes the sheet", await js(`document.querySelector("dialog.sheet") === null`));
        check("focus returns to the row that opened it", await js(`document.activeElement === document.querySelector("#content .task-link")`), await js(`document.activeElement.outerHTML.slice(0, 80)`));

        // APP-110: a row previews on hover and on focus. The card is read-only, stays in the window, and opens the sheet on click.
        const at = await js(`(() => { const r = document.querySelector("#content .task-link").getBoundingClientRect(); return [Math.round(r.left + 24), Math.round(r.top + r.height / 2)]; })()`);
        window.webContents.sendInputEvent({ type: "mouseMove", x: at[0], y: at[1] });
        check("a preview card appears after a short hover", await waitFor(`document.querySelector(".peek")`));
        const peekText = await js(`document.querySelector(".peek")?.textContent ?? ""`);
        const rowTitle = await js(`document.querySelector("#content .task-link b").textContent`);
        check("the card shows title, date, and content, and offers no actions", peekText.startsWith(rowTitle) && /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d+/.test(peekText) && /first ten buyers|management layer/.test(peekText) && await js(`document.querySelectorAll(".peek button").length`) === 0, peekText);
        check("the card stays inside the window", await js(`(() => { const r = document.querySelector(".peek").getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
        await shot("memory-peek");
        await key("keyDown", "Escape");
        await sleep(100);
        check("Escape hides the preview", await js(`document.querySelector(".peek") === null`));
        window.webContents.sendInputEvent({ type: "mouseMove", x: 10, y: 10 });
        await sleep(200);
        // Focus is still on the row from the sheet's return, so leave it and come back as Tab would.
        await js(`document.querySelector("#main").focus(); document.querySelector("#content .task-link").focus();`);
        check("keyboard focus shows the same card", await waitFor(`document.querySelector(".peek")`));
        await js(`document.querySelector(".peek").click()`);
        await waitFor(`document.querySelector("dialog.sheet")`);
        check("clicking the card opens the sheet and drops the card", await js(`document.querySelector("dialog.sheet")?.open === true && document.querySelector(".peek") === null`));
        await key("keyDown", "Escape");
        await sleep(200);

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
        await waitFor(`document.querySelector("dialog.sheet")`);
        check("Enter opens the selected memory's sheet and closes the palette", await js(`document.querySelector("dialog.sheet")?.getAttribute("aria-label") === "Hire management before rapid growth" && !document.querySelector("#palette").open`));
        await key("keyDown", "Escape");
        await sleep(200);
        await js(`document.querySelector("#search").focus(); document.querySelector("#search").click();`);
        check("the sidebar field opens the same palette", await js(`document.querySelector("#palette").open === true`));
        await key("keyDown", "Escape");
        await sleep(200);
        check("esc closes the palette and returns focus to where it was", await js(`!document.querySelector("#palette").open && document.activeElement === document.querySelector("#search")`), await js(`document.activeElement.outerHTML.slice(0, 60)`));
        await js(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }))`);
        await js(`{ const f = document.querySelector("#palette-input"); f.value = "Something Lore has never heard"; f.dispatchEvent(new Event("input")); }`);
        check("no match puts the capture row first, selected", await waitFor(`document.querySelectorAll("#palette .palette-row").length === 1 && document.querySelector("#palette .palette-row.capture[aria-selected=true]")`));
        check("…and the footer says Enter captures", await js(`document.querySelector("#palette-enter").textContent`) === "capture");
        await shot("palette-capture");
        await key("keyDown", "Return");
        await sleep(300);
        check("Enter lands on Today with the text in the composer, focused", await js(`document.querySelector("#title").textContent !== "Inventory" && document.querySelector("#capture-input").value === "Something Lore has never heard" && document.activeElement === document.querySelector("#capture-input")`));
        check("…with the composer showing its focus halo", await js(`(() => { const ring = getComputedStyle(document.querySelector("#composer")); return ring.outlineStyle === "none" && /0px 0px 0px 4px/.test(ring.boxShadow); })()`), await js(`getComputedStyle(document.querySelector("#composer")).boxShadow`));
        await js(`document.querySelector("#capture-input").value = ""; window.__lore.show("memories")`);
        await waitFor(`document.querySelectorAll("#content .task-link").length >= 1`);
        await js(`document.querySelector("#content .task-link").click()`);
        await waitFor(`document.querySelector("dialog.sheet")`);
        await js(`document.querySelector(".sheet .icon-btn").click()`);
        await sleep(100);
        chmodSync(join(process.env.LORE_HOME, "lore.db"), 0o000);
        await js(`document.querySelector("#content .task-link").click()`);
        const shown = await waitFor(`document.querySelector("#status .notice.attention")`);
        chmodSync(join(process.env.LORE_HOME, "lore.db"), 0o600);
        const err = await js(`document.querySelector("#status .notice.attention")?.textContent ?? ""`);
        check("memory open failure is visible on Memories", shown && err.length > 0, err.slice(0, 120));
        await shot("memories-error-notice");

        // Cross-view: notices stay while the owner moves around, then the same tell() lands in the log inside a thread.
        await js(`window.__lore.show("today")`);
        check("notice persists across views", await js(`document.querySelectorAll("#status .notice.attention").length`) === 1);
      }
    } catch (error) {
      results.push(`ERROR ${error.stack}`);
    }
    console.log(results.join("\n"));
    app.exit(results.some((line) => !line.startsWith("PASS")) ? 1 : 0);
  });
});
