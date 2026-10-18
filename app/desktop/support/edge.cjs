// Walks the renderer through the edge audit's two personas against a seeded scratch home.
// Usage: support/edge.sh <scenario>   (seeds LORE_HOME, then runs this under Electron)
const { app } = require("electron");
const { chmodSync, mkdirSync, writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { dirname, join } = require("node:path");
const scenario = process.argv.at(-1);
const S = process.env.LORE_EDGE_OUT ?? process.env.LORE_HOME;
// The scheduler is per user, not per Lore home: point the Codex automations
// lookup at scratch so the owner's real schedule cannot answer for the seed.
if (scenario === "jobs") process.env.CODEX_HOME = join(S, "codex");
const src = join(__dirname, "../src");
const runtime = require(join(src, "runtime.cjs"));
const realProvision = runtime.provision;
let failSetup = scenario === "provision";
// main.cjs binds provision at require time, so the stub itself must flip.
runtime.provision = async (emit) => { if (failSetup) throw new Error("uv exploded"); return realProvision(emit); };

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
/** APP-207: what the owner copied, and every turn the owner started. */
const copied = [];
const prompts = [];
/** APP-214: every store push asked for, and how the walk ends a thread the stand-in agent left working. */
const pushes = [];
let finishThread = (/** @type {AgentTask} */ _kind) => {};
/** APP-214: the next turn fails a moment in, the way agent.mjs reports a thrown turn. */
let failNextTurn = false;
if (scenario === "listing") {
  require("electron").shell.openExternal = async (url) => { opened.push(url); };
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
} else if (scenario === "agents") {
  // APP-207: everything around an agent's save is real (the CLI, the stand-in node's D1 and /agent) except the
  // model and the deploy. The deploy stand-in leaves what a real one does: the node's wrangler, and the store's address.
  require(join(src, "sales.cjs")).notify = (words, onClick) => { notes.push({ words, handlers: { click: onClick } }); };
  require("electron").clipboard.writeText = (text) => { copied.push(text); };
  const setBadgeCount = app.setBadgeCount.bind(app);
  app.setBadgeCount = (count) => { badges.push(count); return setBadgeCount(count); };
  const repo = process.env.LORE_EDGE_REPO ?? "";
  void import(require("node:url").pathToFileURL(join(src, "agent.mjs")).href).then(({ LoreAgent }) => {
    const at = () => new Date().toISOString();
    LoreAgent.prototype.prompt = async function (/** @type {string} */ text, /** @type {AgentTask} */ task) {
      prompts.push({ text, task });
      if (task !== "deploy") return;
      this.options.emit({ type: "task", task: { version: 1, kind: "deploy", title: "Open your store", state: "working", phase: "Setting up your store", updatedAt: at() } });
      const wrangler = join(process.env.LORE_HOME ?? "", "node/node_modules/.bin/wrangler");
      mkdirSync(dirname(wrangler), { recursive: true });
      writeFileSync(wrangler, `#!/bin/sh\ncd "${repo}" && exec uv run python -m tests.fixtures.inbox wrangler "$@"\n`, { mode: 0o755 });
      const url = `${process.env.LORE_EDGE_AGENT_URL}/mcp`;
      execFileSync("uv", ["run", "python", "-c", `import time\nfrom lore.store import Store\nwith Store() as s:\n s.set_setting('node_url', '${url}')\n s.set_setting('node_live', {'url': '${url}', 'checked_at': time.time(), 'live': {'state': 'online', 'network': 'eip155:84532', 'price_usd': 1.0, 'payout': '0x' + 'a' * 40}, 'ids': []})`], { cwd: repo, env: process.env });
      this.options.emit({ type: "task", task: { version: 1, kind: "deploy", title: "Open your store", state: "done", phase: "Finished", updatedAt: at() } });
    };
    LoreAgent.prototype.synthesize = function (/** @type {Reading} */ reading) {
      readings.push(reading);
      const folder = join(process.env.LORE_HOME ?? "", "memories");
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "pricing-sync-by-reach.md"), "# Price a sync placement by its reach\n\nCharge by the audience the placement reaches, not by the hours it took. From what Grok saved, October 2026.\n");
      setTimeout(() => void this.options.memoriesReady?.(reading, { read: reading.added, memories: [{ file: "pricing-sync-by-reach.md", worth_selling: true, why: "a pricing rule from real placements" }] }), 1500);
    };
    require(join(src, "main.cjs"));
  });
} else {
  require(join(src, "main.cjs"));
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const results = [];
function check(name, ok, detail = "") { results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); }

app.on("browser-window-created", (/** @type {unknown} */ _event, /** @type {import("electron").BrowserWindow} */ window) => {
  if (window.getParentWindow()) return; // a page preview, not the app
  const js = (code) => window.webContents.executeJavaScript(code);
  const shot = (name) => window.webContents.capturePage().then((image) => writeFileSync(join(S, `${name}.png`), image.toPNG()));
  const waitFor = async (code, tries = 40) => { for (let i = 0; i < tries; i++) { if (await js(code)) return true; await sleep(250); } return false; };
  const key = async (type, keyCode) => { window.webContents.sendInputEvent({ type, keyCode }); await sleep(30); };

  window.webContents.once("did-finish-load", async () => {
    try {
      // Focus events need a focused page, which a window launched in the background never is.
      window.webContents.debugger.attach();
      await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
      await sleep(1500);
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
        await waitFor(`document.querySelector("#content .strip")`);
        check("Today carries no Recent runs", !(await js(`document.querySelector("#content").textContent.includes("Recent runs")`)));
        await js(`window.__lore.show("automations")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Recent runs")`);
        check("Recent runs is Automations' last section, below the routines", await js(`(() => { const last = document.querySelector("#content").lastElementChild; return last.querySelector("h2")?.textContent === "Recent runs" && Boolean(last.previousElementSibling?.classList.contains("routines")); })()`));
        const runs = await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Recent runs")).textContent`);
        check("a finished capture reads as done, with what it cost", /Capture/.test(runs) && /Saved what you approved/.test(runs) && /\$0\.42/.test(runs), runs);
        check("a failed push says so", /Store update/.test(runs) && /Failed/.test(runs), runs);
        check("a finished push says how big the store is and what changed", /19 publications on your store, 2 more than before/.test(runs), runs);
        check("a run that never reported is unfinished, not successful", /Synthesis/.test(runs) && /Unfinished/.test(runs) && /never reported/.test(runs), runs);
        check("a run still going reads as running", /Store deploy/.test(runs) && /Running/.test(runs), runs);
        // The failure cause names wrangler and a database to the owner, but
        // none of it is durable — history keeps a bounded phrase.
        check("history carries no command or path", !/wrangler|npx|\/Users\//.test(runs), runs);
        await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Recent runs")).scrollIntoView()`);
        await sleep(300);
        await shot("automations-recent-runs");
        // A run with a thread behind it opens that thread from Automations, on Today, as it did from Today.
        await js(`[...document.querySelectorAll("#content .task-link")].find((b) => b.textContent.includes("Store deploy")).click()`);
        check("a Recent runs row opens its thread, saying the run is still going", await waitFor(`document.querySelector("#title").textContent === "Store deploy" && document.querySelector("#eyebrow").textContent === "Working · Running" && !document.querySelector("#task-back").hidden`), `${await js(`document.querySelector("#title").textContent`)} | ${await js(`document.querySelector("#eyebrow").textContent`)}`);
        await js(`document.querySelector("#task-back").click()`);

        // The record is read from the snapshot, not from agent memory, so it is
        // still here after a relaunch — which is the whole point of the table.
        await js(`window.__lore.show("memories")`);
        await sleep(300);
        await js(`window.__lore.show("automations")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Recent runs")`);
        check("history survives leaving and returning", await js(`document.querySelector("#content").textContent.includes("Saved what you approved")`));

        // An owner who has run nothing yet gets a sentence, not a bare heading.
        execFileSync("uv", ["run", "python", "-c", "from lore.store import Store\nwith Store() as s:\n s.db.execute('DELETE FROM owner_jobs')\n s.db.commit()"], { cwd: join(__dirname, "../../.."), env: process.env });
        // A "changed" event is what makes the renderer re-read the snapshot;
        // switching views alone re-renders what it already had.
        await js(`window.__lore.event({ type: "changed" })`);
        // The re-read runs the CLI several times; on a busy Mac it takes longer than any fixed pause.
        check("an owner with no runs yet sees no Recent runs section", await waitFor(`![...document.querySelectorAll("#content .section")].some((s) => s.textContent.includes("Recent runs"))`));
        check("the rest of Automations still renders", await js(`document.querySelector("#content .routines") !== null`));
        await shot("automations-recent-runs-empty");

        // AUT-010: a reading Codex ran, every Sunday at 9 PM, is Lore's from the first launch, with no agent named.
        await js(`window.__lore.show("connectors")`);
        const rhythm = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How often Lore reads them"))?.textContent ?? ""`;
        check("a reading Codex ran is Lore's now, on the owner's day and hour", await waitFor(`/Every Sunday at 9 PM, while Lore is open\\. Hasn't run yet\\./.test(${rhythm})`) && !/Codex|Claude/.test(await js(rhythm)), await js(rhythm));
        await shot("settings-taken-over");
        await js(`window.__lore.show("automations")`);
        const reading = `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector("b")?.textContent === "Read connected apps")?.textContent ?? ""`;
        check("…and Automations lists it like any other, with Run now", await waitFor(`(${reading}).includes("Every Sunday at 9 PM · Next")`) && !/Codex|Claude| by /.test(await js(reading)) && await js(`Boolean(document.querySelector("#content .routine-act[aria-label='Run now']"))`), await js(reading));
        await shot("automations-taken-over");
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
        check("a saved price closes the sheet", await waitFor(`!document.querySelector("dialog.form-sheet[open]")`));
        await waitFor(`document.querySelector("#content").textContent.includes("Your store still charges $0.02.")`);
        check("a saved price the node does not charge yet says so on For Sale", await js(`document.querySelector("#content .store-bar").textContent.includes("$0.75") && document.querySelector("#content .store-bar").textContent.includes("Your store still charges $0.02.")`));
        await shot("store-stale-price");
        await js(`window.__lore.show("today")`);
        await sleep(400);
        const nextStep = `(document.querySelector("#content .next-step")?.textContent ?? "")`;
        check("Today's next step is the update, in plain words", await js(`${nextStep}.includes("1 change isn't live yetYour store still charges $0.02, not $0.75Update store")`), await js(nextStep));
        // Fix 5: approved work the node does not hold yet gets a standing Push, on For Sale and as Today's next step.
        await js(`window.__lore.show("today")`);
        await sleep(400);
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Approve").click()`);
        await waitFor(`document.querySelector("#content").textContent.includes("approved, not on your store yet")`);
        // The staged node answers the ledger query with two sales, one of them the publication just approved.
        const publicId = await js(`window.lore.snapshot().then((s) => s.publications.items.find((i) => i.state === "approved").public_id)`);
        const wrangler = join(process.env.LORE_HOME, "node/node_modules/.bin/wrangler");
        mkdirSync(dirname(wrangler), { recursive: true });
        const sale = (item_id, title, tx, sold_at) => ({ kind: "publication", item_id, title, price_usd: 0.01, network: "eip155:84532", payer: "0xpayer", tx, sold_at });
        writeFileSync(wrangler, `#!/bin/sh\necho '${JSON.stringify([{ results: [sale(publicId, "Hire management before rapid growth", "0xfeed", "2026-09-02T14:02:00Z"), sale("1111111111111111807ae5f3", "Choosing a co-founder", "0xbeef", "2026-09-01T21:47:00Z")], success: true }])}'\n`, { mode: 0o755 });
        await js(`window.__lore.show("store")`);
        check("the ledger is checked while it loads", await js(`document.querySelector("#content").textContent.includes("Checking your store…")`));
        await waitFor(`document.querySelector("#content").textContent.includes("2 sales")`);
        const store = await js(`document.querySelector("#content").textContent`);
        check("the Sales section sums the ledger", store.includes("2 sales · $0.02 · last Sep 2"), store.slice(-200));
        check("each sale links to its transaction", await js(`[...document.querySelectorAll("#content a.link-btn.glyph")].map((a) => a.href).join(" ")`) === "https://sepolia.basescan.org/tx/0xfeed https://sepolia.basescan.org/tx/0xbeef");
        check("no hash is spelled out in the row", !store.includes("0xfeed"));
        check("the approved publication counts its sales", store.includes("1 sold"));
        check("the For Sale bar links to payouts", await js(`[...document.querySelectorAll("#content .store-bar a.link-btn")].some((a) => a.textContent === "Payouts ↗")`));
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
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content .strip")`);
        // AUT-009: with no profile, Lore's own routines are on from the start, and the owner is told once.
        const told = `[...document.querySelectorAll("#status .notice")].filter((n) => n.textContent.includes("Change this in Automations"))`;
        check("the first launch says once that Lore reads and checks in on its own", await waitFor(`${told}.length === 1`) && (await js(`${told}[0].textContent`)).startsWith("Lore reads your connected apps every day at 9 AM and checks in at 6 PM when something's worth asking."), await js(`document.querySelector("#status").textContent`));
        check("…alongside the usage notice, not in place of it", await waitFor(`document.querySelector("#status").textContent.includes("anonymous usage events")`) && await js(`${told}.length === 1`));
        check("…and remembers having said it", await waitFor(`window.lore.snapshot().then((s) => s.setup.automations_noticed === true)`));
        await shot("automations-on-notice");
        await js(`[...${told}[0].querySelectorAll("button")].find((b) => b.textContent === "Automations").click()`);
        await sleep(500);
        check("its Automations button shows both of Lore's own on", await js(`document.querySelector("#title").textContent`) === "Automations" && await js(`[...document.querySelectorAll("#content .switch")].map((s) => s.getAttribute("aria-label") + "=" + s.getAttribute("aria-checked")).join("|")`) === "Pause Read connected apps=true|Pause Evening check-in=true", await js(`document.querySelector("#content").textContent`));
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
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content .strip")`);
        await sleep(1500);
        check("opened again, it says nothing more about it", !(await js(`document.querySelector("#status").textContent.includes("Change this in Automations")`)), await js(`document.querySelector("#status").textContent`));
      } else if (scenario === "obsidian") {
        // APP-124: an app by name, one Connect, the vault offered rather than asked for.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content .strip")`);
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
        await waitFor(`document.querySelector("#content .strip")`);
        // APP-127, APP-214: an owner with nothing connected is pointed at Connectors, and nothing to publish yet.
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
        const apps = JSON.stringify(["Obsidian", "ChatGPT", "Claude", "Substack", "Medium", "Bluesky", "Blog or newsletter", "Letterboxd", "Goodreads", "Granola", "Notion", "Readwise"]);
        const offered = await js(`${apps}.map((n) => ${sourceRows}.find((r) => r.querySelector("b").textContent === n)?.textContent ?? "")`);
        check("every app in the catalog is offered by name, in its own words", offered.length === 12 && /Connect/.test(offered[0]) && /Import/.test(offered[1]) && /Import/.test(offered[2]) && offered.slice(3, 9).every((t) => /Connect/.test(t)) && offered.slice(9).every((t) => /Sign in/.test(t)) && !offered.some((t) => /folder|source|markdown|feed|rss|url|mcp|oauth|token/i.test(t)), offered.join(" | "));
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
      } else if (scenario === "faq") {
        // APP-118: one page that says what Lore does and how the money works, in plain words.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content .strip")`);
        // APP-201: the sidebar holds the main places; Settings, help and feedback live in the account menu.
        const nav = await js(`[...document.querySelectorAll("nav button")].map((b) => b.dataset.view).join()`);
        check("the sidebar lists only the four main places", nav === "today,inventory,connectors,automations", nav);
        check("…and no lone feedback link outside the account menu", await js(`document.querySelector("#account-menu").contains(document.querySelector("#feedback-open")) && !document.querySelector("aside > .feedback-open")`));
        // APP-202, APP-214: How it works is for an owner with nothing kept yet (the today walk covers it); this one has memories.
        check("an owner with memories is not offered How it works", await js(`document.querySelector("#content .strip") !== null && document.querySelector("#content .how-it-works") === null`));
        await js(`document.querySelector("#account").click()`);
        const menu =await js(`[...document.querySelectorAll("#account-menu button:not([hidden]), #account-menu p")].map((b) => b.textContent).join("|")`);
        check("the account row opens a menu: Settings, Help & FAQ, feedback when it can be sent, then who is signed in", /^Settings⌘,\|Help & FAQ\|(Report feedback\|)?Signed in with Claude\|Sign out of Claude$/.test(menu), menu);
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
        check("another sheet opens while the report is in flight", await waitFor(`!!document.querySelector("dialog.sheet .btn.quiet")`));
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
        const paid = await js(`${rowOf("Get paid")}?.textContent ?? ""`);
        check("Get paid names both ways in, card first", /By card.*agents in a browser.*Stripe.*On.*To your wallet.*0x0c27…8166/.test(paid), paid);
        check("…with the wallet one link away", await js(`[...${rowOf("Get paid")}.querySelectorAll("a.link-btn")].some((a) => a.textContent === "View ↗" && a.href === "https://basescan.org/address/0x0c270534cfcecc9224edb903ef5dd70410d08166")`));
        check("paid answers get their own row", await js(`${rowOf("Paid answers")}?.textContent.includes("$0.10 per answer")`));
        check("the home folder is one click from Finder", await js(`${rowOf("Where it lives")}?.textContent.includes("Show in Finder")`));
        await js(`${rowOf("Price")}.querySelector("button").click()`);
        await waitFor(`Boolean(document.querySelector("dialog.form-sheet[open]"))`);
        check("Change opens one sheet for price and free copies", await js(`[...document.querySelectorAll("dialog.form-sheet[open] .form-row")].map((r) => r.querySelector(".form-label").textContent).join("|") === "Price per piece|Free copies" && document.querySelectorAll("dialog.form-sheet[open] input").length === 2 && document.querySelector("#title").textContent === "Inventory"`));
        await shot("store-price-sheet");
        await js(`{ const [amount, copies] = document.querySelectorAll("dialog.form-sheet[open] input"); amount.value = "0.75"; copies.value = "5"; amount.form.requestSubmit(); }`);
        check("both save through the CLI", await waitFor(`window.lore.snapshot().then((s) => s.pricing.publication_usd === 0.75 && s.pricing.free_copies === 5)`));
        check("…and a live store is updated without being asked", await waitFor(`!document.querySelector("#status").textContent.includes("next push") && (document.querySelector("#content").textContent.includes("Your store is updated") || [...document.querySelectorAll("#content button")].some((b) => b.textContent === "Update store"))`));
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
        check("…carrying the edit made on the card", /Not useful if: you have no buyers yet|not useful if: you have no buyers yet/i.test(execFileSync("uv", ["run", "lore", "publication", "list"], { cwd: join(__dirname, "../../.."), env: process.env, encoding: "utf8" })));
        check("…and says how the store update went, once it has", await waitFor(`/have their new pages|go live with your next store update/.test(document.body.textContent) && !document.body.textContent.includes("updating your store. It takes")`));
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
        await waitFor(`document.querySelector("#content .strip")`);
        // APP-214: Claude Code is on this Mac, but Today asks only for the owner's own AI, and never names coding agents.
        const todayText = `document.querySelector("#content").textContent`;
        check("Today's one next step is to connect the owner's AI", await waitFor(`(document.querySelector("#content .next-step")?.textContent ?? "").includes("Connect the AI you talk to most")`) && !/Claude Code|Codex/.test(await js(todayText)), await js(todayText));
        await js(`window.__lore.show("connectors")`);
        check("Connectors has a group for the owner's agents, offering to connect one", await waitFor(`${agentRow("Connect an agent")}?.querySelector("img.logo")`));
        check("…and the catalog offers no generic Personal agent", !(await js(`[...document.querySelectorAll("#content .row b")].some((b) => b.textContent === "Personal agent")`)));
        await shot("agents-offer");

        // No store online: the sheet puts it online first, the way the store always goes online, then picks up.
        await js(`${agentRow("Connect an agent")}.querySelector("button").click()`);
        await waitFor(`${primary}?.textContent === "Put your store online"`);
        await sleep(400);
        check("with no store online, the first step says why it goes online, plainly", await js(`${sheet}.includes("Your agents save to your own store, so it needs to be online. Nothing goes on sale until you approve it.")`), await js(sheet));
        await shot("agents-store-first");
        await js(`${primary}.click()`);
        const deploying = await waitFor(`document.querySelector("#title").textContent === "Open your store"`);
        for (let i = 0; i < 40 && !prompts.length; i++) await sleep(100);
        check("…and puts it online through the store's own deploy", deploying && prompts.some((p) => p.task === "deploy" && /personal agents/.test(p.text)), JSON.stringify(prompts));
        check("once the store is online, the sheet continues to the setup", await waitFor(`${sheet}.includes("Which agent should save to Lore?")`, 80), await js(sheet));
        const picks = await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].map((o) => o.textContent)`);
        check("…offering each of the five, each with its mark", JSON.stringify(picks) === JSON.stringify(["Grok Bot", "Muse", "ChatGPT", "Claude", "Other"]) && await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].every((o) => o.querySelector("img.logo"))`), JSON.stringify(picks));
        check("Connect waits for a choice", await js(`${primary}.disabled`));
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent === "Grok Bot").querySelector("input").click()`);
        await sleep(400);
        await shot("agents-pick");
        await js(`${primary}.click()`);
        check("connecting Grok Bot turns the sheet into Grok Bot's, with its mark", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "Connect Grok Bot"`, 80) && await js(`document.querySelector("dialog.sheet[open] .form-head img.logo").src.endsWith("assets/grok.svg")`), await js(sheet));
        const setup = await js(sheet);
        check("…the way in, as a path: Grok Bot, Connect apps, Custom connector", JSON.stringify(await js(`[...document.querySelectorAll("dialog.sheet[open] .agent-path span")].map((s) => s.textContent)`)) === JSON.stringify(["Grok Bot", "Connect apps", "Custom connector"]), setup);
        check("…one link and nothing else to paste: no key, no instructions, no numbered steps", await js(`document.querySelectorAll("dialog.sheet[open] .agent-link").length === 1 && !document.querySelector("dialog.sheet[open] .copy-row, dialog.sheet[open] .agent-steps")`), setup);
        check("…its key masked, and a quiet private-link line", /••••/.test(setup) && !/lore_agent_/.test(setup) && setup.includes("Private link, shown once") && !/\bmcp\b|token|mainnet/i.test(setup), setup);
        check("…and it waits for Grok Bot's first save", setup.includes("Waiting for Grok Bot's first save…"), setup);
        // APP-214: connected, with nothing saved and nothing kept yet, Today (rendered as it stands) stops asking to connect.
        const todayNow = `renderToday(snapshot).map((p) => p.textContent).join(" ")`;
        check("as soon as Grok Bot is connected, before its first save, Today stops asking to connect an agent", await waitFor(`snapshot.library.counts.private === 0 && snapshot.library.sources.some((s) => s.connector === "agent") && !(${todayNow}).includes("Connect the AI you talk to most")`, 80), await js(todayNow));
        const copyLink = async () => {
          const before = copied.length;
          await js(`document.querySelector("dialog.sheet[open] .agent-link").click()`);
          for (let i = 0; i < 20 && copied.length === before; i++) await sleep(50);
          return copied.at(-1) ?? "";
        };
        const copyOf = async (label) => {
          const before = copied.length;
          await js(`[...document.querySelectorAll("dialog.sheet[open] .copy-row")].find((r) => r.querySelector(".form-label").textContent === ${JSON.stringify(label)}).querySelector("button").click()`);
          for (let i = 0; i < 20 && copied.length === before; i++) await sleep(50);
          return copied.at(-1) ?? "";
        };
        const address = await copyLink();
        check("Copy gives one link with the key in it", new RegExp(`^${agentUrl.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}/lore_agent_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$`).test(address), address);
        // The clipboard stand-in records the copy before the renderer hears back, so wait for the link to say it.
        check("…and the link says it copied", await waitFor(`document.querySelector("dialog.sheet[open] .agent-link").classList.contains("copied") && document.querySelector("dialog.sheet[open] .agent-link").textContent.includes("Copied")`, 20));
        await shot("agents-setup");

        // Grok saves, with the key it was given, and the sheet hears it.
        const key = address.slice(agentUrl.length + 1);
        const stored = await (await call(key, "tools/call", { name: "store", arguments: { items: [{ title: "How I price sync placements", content: "I charge by the audience the placement reaches, not by the hours it took.", key: "sync-pricing", kind: "preference" }] } })).json();
        check("a save with that key reaches the store", stored.result?.isError === false, JSON.stringify(stored));
        check("…and the sheet says Grok Bot saved its first memory", await waitFor(`${sheet}.includes("Grok Bot saved its first memory")`, 80), await js(sheet));
        await shot("agents-first-save");
        check("…read through once, named for Grok", readings.length === 1 && readings[0].title === "Grok Bot saved 1 thing to Lore" && readings[0].label === "Grok Bot", JSON.stringify(readings));
        await press("Done");
        for (let i = 0; i < 60 && !notes.length; i++) await sleep(250);
        check("its memories are one Mac notification that names Grok", notes.length === 1 && notes[0].words.title === "Grok Bot saved 1 thing to Lore" && notes[0].words.body === "1 new memory. 1 looks worth selling.", JSON.stringify(notes.map((n) => n.words)));
        check("…and a red 1 on the dock", badges.at(-1) === 1, JSON.stringify(badges));
        check("Grok's row says what it saved, and when", await waitFor(`/Saved 1 · last today/.test(${agentRow("Grok Bot")}?.textContent ?? "")`), await js(`${agentRow("Grok Bot")}?.textContent ?? ""`));
        check("…with Grok's mark, and the offer to connect another", await js(`${agentRow("Grok Bot")}.querySelector("img.logo").src.endsWith("assets/grok.svg") && Boolean(${agentRow("Connect another agent")})`));
        await shot("agents-connected");
        app.emit("browser-window-focus");
        await sleep(3000);
        check("coming back to the app finds nothing more, and says nothing again", notes.length === 1 && readings.length === 1, String(notes.length));

        notes[0].handlers.click();
        const card = `[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("New memories"))`;
        check("clicking it lands on Today's new memories, named for Grok", await waitFor(`${card}?.textContent.includes("Grok Bot saved 1 thing to Lore")`));
        const cardText = await js(`${card}.textContent`);
        check("…each memory says it came from Grok", cardText.includes("Price a sync placement by its reach") && cardText.includes("From Grok Bot · Worth selling"), cardText);
        await shot("agents-today");
        check("with Grok Bot connected, Today never asks to connect an agent", !(await js(`${todayText}.includes("Connect the AI you talk to most")`)) && !/Claude Code|Codex/.test(await js(todayText)), await js(todayText));
        const order = await js(`JSON.stringify([...document.querySelectorAll("#content .section-head h2")].map((h) => h.textContent))`);
        check("…its new memories lead, and the next step follows them", /"New memories".*"Next step"/.test(order), order);
        await js(`window.__lore.show("memories")`);
        const saved = `[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How I price sync placements"))`;
        // APP-208: a date-only save shows the day it names, whatever the Mac's time zone.
        check("a date-only save shows the day it names", await js(`when("2026-10-17")`) === "Oct 17" && await js(`when("2026-10-17T03:00:00Z")`) === await js(`new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date("2026-10-17T03:00:00Z"))`));
        check("what Grok Bot saved is in Memories, from Grok", await waitFor(`/From Grok Bot/.test(${saved}?.textContent ?? "")`), await js(`${saved}?.textContent ?? ""`));
        await js(`${saved}.querySelector(".task-link").click()`);
        check("…and its sheet says so", await waitFor(`/From Grok Bot/.test(document.querySelector("dialog.sheet[open] .sheet-head")?.textContent ?? "")`), await js(sheet));
        await shot("agents-memory-from");
        await js(`document.querySelector("dialog.sheet[open] .icon-btn").click()`);

        // Manage: a new key stops the old one, and Disconnect stops the agent and keeps what it saved.
        await js(`window.__lore.show("connectors")`);
        await waitFor(agentRow("Grok Bot"));
        await js(`${agentRow("Grok Bot")}.querySelector("button").click()`);
        check("Manage offers a new key and Disconnect", await waitFor(`${sheet}.includes("Get a new key") && ${sheet}.includes("Disconnect")`));
        await press("Get a new key");
        await waitFor(`${primary}?.textContent === "Get a new key"`);
        check("…and says the old key stops at once", /stops working at once/.test(await js(sheet)), await js(sheet));
        await js(`${primary}.click()`);
        check("a new key shows the setup again", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "A new link for Grok Bot"`, 80) && !(await js(`${sheet}.includes("Waiting for")`)), await js(sheet));
        const fresh = (await copyLink()).slice(agentUrl.length + 1);
        check("…with a different key", fresh !== key && fresh.startsWith(key.slice(0, "lore_agent_".length + 16)), fresh);
        check("…the old one no longer works", (await call(key, "tools/list")).status === 401);
        check("…and the new one does", (await call(fresh, "tools/list")).status === 200);
        await shot("agents-new-key");
        await press("Done");
        await sleep(300);
        await js(`${agentRow("Grok Bot")}.querySelector("button").click()`);
        await waitFor(`${sheet}.includes("Disconnect")`);
        await press("Disconnect");
        await waitFor(`${sheet}.includes("Disconnect Grok Bot?")`);
        check("Disconnect offers to keep or delete what Grok Bot saved", /The 1 memory it saved stays in your library/.test(await js(sheet)) && await js(`[...document.querySelectorAll("dialog.sheet[open] button")].some((b) => b.textContent === "Delete them too")`), await js(sheet));
        await shot("agents-disconnect");
        await press("Disconnect");
        check("disconnecting keeps its memory and says so", await waitFor(`document.querySelector("#status").textContent.includes("Disconnected Grok Bot. 1 memory kept.")`, 80), await js(`document.querySelector("#status").textContent`));
        check("…takes Grok off Connectors", await waitFor(`!${agentRow("Grok Bot")} && Boolean(${agentRow("Connect an agent")})`));
        check("…and its key stops working", (await call(fresh, "tools/list")).status === 401);
        await shot("agents-disconnected");

        // Any other app gets honest, general steps, and is told some apps need a sign-in Lore doesn't offer yet.
        await js(`${agentRow("Connect an agent")}.querySelector("button").click()`);
        await waitFor(`${sheet}.includes("Which agent should save to Lore?")`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] .form-option")].find((o) => o.textContent === "Claude").querySelector("input").click()`);
        await js(`${primary}.click()`);
        check("Claude gets general steps, under its own name", await waitFor(`document.querySelector("dialog.sheet[open] .form-head h2")?.textContent === "Connect Claude" && ${sheet}.includes("In Claude's settings, find where to add a connector.") && ${sheet}.includes("Waiting for Claude's first save…")`, 80), await js(sheet));
        check("…keeping the instructions where Claude remembers them", (await js(sheet)).includes("Add the instructions where Claude keeps standing instructions, like custom instructions or a skill, so it remembers what to save in every chat."), await js(sheet));
        check("…and is told plainly that a sign-in is coming", /can only connect through a sign-in, which Lore doesn't offer yet\. It's coming\./.test(await js(sheet)) && !/\bmcp\b|oauth|token/i.test(await js(sheet)), await js(sheet));
        check("…and its instructions use that name", (await copyOf("Instructions")).includes("You are Claude"));
        await sleep(300);
        await shot("agents-claude-setup");
        await press("Done");
        check("…and it joins the agents with Claude's mark", await waitFor(`${agentRow("Claude")}?.querySelector("img.logo")?.src.endsWith("assets/claude.svg") && /Nothing saved yet/.test(${agentRow("Claude")}.textContent)`), await js(`${agentRow("Claude")}?.textContent ?? ""`));

        // Claude Code's own memory on this Mac connects from its tile, and turns off from it again.
        const histories = `[...document.querySelectorAll("#content section")].find((s) => s.querySelector("h2")?.textContent === "Your apps")`;
        const claudeCode = `[...(${histories}?.querySelectorAll(".row") ?? [])].find((r) => r.querySelector("b").textContent === "Claude Code")`;
        check("Claude Code is offered, with a way to connect it", await waitFor(`${claudeCode}?.querySelector("button")?.textContent === "Connect"`), await js(`${claudeCode}?.textContent ?? ""`));
        await js(`${claudeCode}.click()`);
        check("…a click on its tile says what Lore will read, plainly", await waitFor(`${sheet}.includes("Lore reads the memory notes Claude Code keeps for each of your projects on this Mac")`), await js(sheet));
        await shot("agents-history-connect");
        await js(`${primary}.click()`);
        check("…and Connect turns it on and brings in what it remembers", await waitFor(`/Connected/.test(${claudeCode}?.textContent ?? "") && /1 memory imported/.test(${claudeCode}.textContent)`, 120), await js(`${claudeCode}?.textContent ?? ""`));
        await js(`${claudeCode}.click()`);
        await waitFor(`${primary}?.textContent === "Turn off"`);
        await js(`${primary}.click()`);
        check("…Turn off keeps what it brought in and says so", await waitFor(`document.querySelector("#status").textContent.includes("Turned off Claude Code. What it brought in stays.") && ${claudeCode}?.querySelector("button")?.textContent === "Connect"`, 80), await js(`document.querySelector("#status").textContent`));
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
        await waitFor(`document.querySelector("#content .strip")`);
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
        check("…and once closed it stays closed", await js(`document.querySelector("#content .strip") !== null && document.querySelector("#content .how-it-works") === null`));
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
        check("…in the next step's place, said once, with the stats line last", !order.includes("Next step") && (await js(today)).split("Buyers only ever get what you approve").length === 2 && await js(`document.querySelector("#content").lastElementChild.classList.contains("strip")`), order);
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
        check("…while the repair runs, Today offers no next step, though the store still isn't answering", await waitFor(`${steps}.length === 0 && document.querySelector("#content .strip").textContent.includes("Store offline")`), await js(today));
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
        check("f: with nothing waiting on the owner, Today shows no next step", await waitFor(`!${today}.includes("isn't responding") && ${steps}.length === 0 && document.querySelector("#content .strip").textContent.includes("2 for sale")`, 80), await js(today));
        check("…and a connected app is enough not to be asked to connect", !(await js(`${today}.includes("Connect the AI you talk to most")`)));
        await shot("today-f-nothing");
        check("no moment of the walk showed more than one next step", (await js(`window.__steps`)) === 1, String(await js(`window.__steps`)));
      } else if (scenario === "reading") {
        // AUT-005: connect Granola, and Lore reads the meetings through without being asked.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content .strip")`);
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
        await shot("reading-today-working");
        await js(`window.__lore.show("connectors")`);
        for (let i = 0; i < 60 && !notes.length; i++) await sleep(250);
        check("a finished reading is one Mac notification", notes.length === 1 && notes[0].words.title === "Lore read your Granola meetings" && notes[0].words.body === "2 new memories. 1 looks worth selling.", JSON.stringify(notes.map((n) => n.words)));
        check("…and a red 2 on the dock while the owner is elsewhere", badges.at(-1) === 2, JSON.stringify(badges));
        check("…and the notice that it was reading goes away", await waitFor(`!document.querySelector("#status").textContent.includes("Lore is turning them into memories now.")`), await js(`document.querySelector("#status").textContent`));
        notes[0].handlers.click();
        check("clicking it lands on Today's new memories", await waitFor(`document.querySelector("#content").textContent.includes("Lore read your Granola meetings")`), await js(`document.querySelector("#title").textContent + " | " + document.querySelector("#content").textContent.slice(0, 200)`));
        const card = `[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("New memories"))`;
        const cardText = await js(`${card}.textContent`);
        check("…each by title, only on this Mac", /2 new memories, only on this Mac · 1 looks worth selling/.test(cardText) && cardText.includes("Raise the first price only after ten buyers pay") && cardText.includes("Add the ops management layer before the next ten hires"), cardText);
        check("…work stays private and is never offered for sale", cardText.includes("Work · stays private") && await js(`[...${card}.querySelectorAll(".row")].filter((r) => [...r.querySelectorAll("button")].some((b) => b.textContent === "Draft for sale")).map((r) => r.querySelector("b").textContent).join("|")`) === "Raise the first price only after ten buyers pay");
        check("…in plain words", !/synthes|agent|pipeline|mcp/i.test(cardText), cardText);
        check("seeing it clears the dock", await (async () => { for (let i = 0; i < 40 && badges.at(-1) !== 0; i++) await sleep(100); return badges.at(-1) === 0; })(), JSON.stringify(badges));
        await shot("reading-today-ready");
        await js(`window.__lore.show("memories")`);
        check("the memories are in Inventory, grouped under work and personal", await waitFor(`document.querySelector("#content").textContent.includes("Raise the first price only after ten buyers pay")`) && await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("ops management"))?.closest(".inv-group")?.querySelector(".inv-group-head b")?.textContent === "work"`));
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
        await waitFor(`document.querySelector("#content .strip")`);
        await js(`document.querySelector("nav [data-view=automations]").click()`);
        const rowOf = (/** @type {string} */ name) => `[...document.querySelectorAll("#content .row")].find((r) => r.querySelector("b")?.textContent === ${JSON.stringify(name)})`;
        const SUNDAY = "Every Sunday, remember what I read this week";
        check("the tab lists Lore's own first, then the owner's", await waitFor(`${rowOf(SUNDAY)}`) && await js(`[...document.querySelectorAll("#content .row b")].map((b) => b.textContent).join("|")`) === `Read connected apps|Evening check-in|${SUNDAY}|New automation`, await js(`[...document.querySelectorAll("#content .row b")].map((b) => b.textContent).join("|")`));
        const text = await js(`document.querySelector("#content").textContent`);
        check("…each with when it runs and what it last did", /Every day at 9 AM · Next \w+ \d+ · Hasn.t run yet/.test(text) && text.includes("Every weekday at 6 PM") && text.includes("Every Sunday at 6 PM"), text);
        check("…in plain words", !/cron|executor|schedul|routine|prompt/i.test(text), text);
        const menuOf = (/** @type {string} */ name) => `[...${rowOf(name)}.querySelectorAll(".routine-act")].map((b) => b.getAttribute("aria-label")).join("|")`;
        check("Lore's own can be paused but not removed", await js(menuOf("Evening check-in")) === "Change time|Run now" && await js(menuOf(SUNDAY)) === "Change time|Run now|Remove", `${await js(menuOf("Evening check-in"))} / ${await js(menuOf(SUNDAY))}`);
        await shot("automations");
        // Every action sits on its card: no menu to open, nothing to be cut off.
        check("no row hides its actions behind a ⋯", await js(`!document.querySelector("#content [aria-label^='More for'], #content .row-menu-items")`));
        await js(`${rowOf("Evening check-in")}.querySelector(".switch").click()`);
        check("the switch pauses it, and the CLI keeps that", await waitFor(`${rowOf("Evening check-in")}?.querySelector(".switch").getAttribute("aria-checked") === "false"`) && listed().find((/** @type {Routine} */ r) => r.id === "checkin").paused === true);
        check("…so it shows paused after a fresh read", await js(`window.lore.routines().then((all) => all.find((r) => r.id === "checkin").paused)`) === true && (await js(`${rowOf("Evening check-in")}.textContent`)).includes("Paused"));
        await js(`${rowOf(SUNDAY)}.querySelector(".routine-act[aria-label='Change time']").click()`);
        await waitFor(`Boolean(document.querySelector("dialog.form-sheet[open] select"))`);
        await js(`{ const [cadence, , hour] = document.querySelectorAll("dialog.sheet[open] select"); cadence.value = "daily"; cadence.dispatchEvent(new Event("change")); hour.value = "7"; }`);
        check("Change time hides the day for a daily rhythm, and the row shows the choice", await js(`(() => { const [cadence, day] = document.querySelectorAll("dialog.sheet[open] select"); return day.closest(".form-row").hidden && cadence.closest(".form-row").querySelector(".form-value").textContent === "Every day"; })()`));
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        check("…and saves the new time", await waitFor(`${rowOf(SUNDAY)}?.textContent.includes("Every day at 7 AM")`) && mine().hour === 7 && mine().cadence === "daily", JSON.stringify(mine()));
        await js(`${rowOf(SUNDAY)}.querySelector(".routine-act[aria-label='Run now']").click()`);
        for (let i = 0; i < 40 && !readings.length; i++) await sleep(250);
        check("Run now hands the owner's sentence to Lore's quiet reading", readings.length === 1 && readings[0].ask === SUNDAY, JSON.stringify(readings));
        check("…and its row says it is running until the reading is done", (await js(`${rowOf(SUNDAY)}.textContent`)).includes("Running now…"), await js(`${rowOf(SUNDAY)}.textContent`));
        for (let i = 0; i < 60 && !notes.length; i++) await sleep(250);
        check("…which writes private memories and says so, named by its sentence", notes.length === 1 && notes[0].words.title === `“${SUNDAY}”` && notes[0].words.body === "2 new memories. 1 looks worth selling.", JSON.stringify(notes.map((n) => n.words)));
        check("…and records what it found", await (async () => { for (let i = 0; i < 20 && mine().result !== "2 new memories"; i++) await sleep(250); return mine().result === "2 new memories"; })(), JSON.stringify(mine()));
        check("…then says it is done, once, without a second banner", await waitFor(`document.body.textContent.includes(${JSON.stringify(`“${SUNDAY}” is done · 2 new memories`)})`) && notes.length === 1, JSON.stringify(notes.map((n) => n.words)));
        await js(`window.__lore.show("today")`);
        const heading = `[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("New memories"))?.querySelector(".list-aside span")?.textContent ?? ""`;
        check("Today names it by its sentence alone", await waitFor(`(${heading}).startsWith(${JSON.stringify(`“${SUNDAY}” · `)})`), await js(heading));
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
        window.show();
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
        await js(`${rowOf("Evening check-in")}.querySelector(".routine-act[aria-label='Change time']").click()`);
        await waitFor(`Boolean(document.querySelector("dialog.form-sheet[open] select"))`);
        await js(`{ const [cadence, , hour] = document.querySelectorAll("dialog.sheet[open] select"); cadence.value = "daily"; cadence.dispatchEvent(new Event("change")); hour.value = "${earlier}"; }`);
        await js(`document.querySelector("dialog.sheet[open] .btn.primary").click()`);
        await waitFor(`${rowOf("Evening check-in")}?.textContent.includes("Every day at")`);
        await sleep(2500);
        check("…and moving it to an hour already past waits for tomorrow", checkInOf().hour === earlier && !checkInOf().due && Date.parse(checkInOf().next_run) - Date.now() > 20 * 60 * 60_000 && checkInOf().last_run.startsWith(new Date(Date.now() - 4 * 86400_000).toISOString().slice(0, 10)), JSON.stringify(checkInOf()));
        await js(`document.querySelector("#content .add-tile").click()`);
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
        await js(`document.querySelector("#content .add-tile").click()`);
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
        check("Today shows what the store has earned, and the sale", await waitFor(`document.querySelector("#content").textContent.includes("$3.00 earned") && document.querySelector("#content").textContent.includes("by card")`));
        for (let i = 0; i < 60 && !existsSync(join(process.env.LORE_DESKTOP_USER_DATA ?? "", "sales-seen.json")); i++) await sleep(250);
        check("a sale from before is never announced", notes.length === 0, String(notes.length));
        await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("earned"))?.scrollIntoView({ block: "center" })`);
        await sleep(300);
        await shot("sales-today");
        await arrive(sale("pi_new", "2026-10-04T18:00:00Z"));
        check("a new sale is a Mac notification", notes.length === 1 && notes[0].words.title === "You sold a piece" && notes[0].words.body === "Live demos beat cold decks · $3.00 by card", JSON.stringify(notes.map((n) => n.words)));
        check("…and Today counts it", await waitFor(`document.querySelector("#content").textContent.includes("$6.00 earned")`));
        await arrive(...[1, 2, 3, 4, 5].map((n) => sale(`0xtx${n}`, `2026-10-04T19:0${n}:00Z`, "eip155:8453", 0.5)));
        check("many at once are one notification", notes.length === 2 && notes[1].words.title === "You sold 5 pieces" && notes[1].words.body === "$2.50", JSON.stringify(notes.map((n) => n.words)));
        app.emit("browser-window-focus");
        await sleep(2000);
        check("a sale is announced once", notes.length === 2, String(notes.length));
        notes[1].handlers.click();
        check("clicking it opens Inventory, on sale", await waitFor(`document.querySelector("#title").textContent === "Inventory" && document.querySelector(".shelf[aria-selected=true]")?.textContent.startsWith("On sale")`));
        check("For Sale shows each piece's page views and how each sale was paid", await waitFor(`document.querySelector("#content").textContent.includes("42 views") && document.querySelector("#content").textContent.includes("by an agent")`));
        await shot("sales-for-sale");
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
        check("the payout question is the guided card: Coinbase first, its taps, one address field", await js(`(() => { const f = document.querySelector("#request fieldset.payout"); return Boolean(f) && f.querySelector("input:checked")?.value === "My Coinbase account" && /Set the network to Base/.test(f.querySelector(".payout-steps").textContent) && f.querySelectorAll("input[type=text]").length === 1; })()`));
        await js(`(() => { const f = document.querySelector("#request fieldset.payout"); f.querySelectorAll("input[type=radio]")[1].click(); return true; })()`);
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
        check("owner turns are right-aligned bubbles while Lore stays open", await js(`(() => { const owner = document.querySelector("#log .line.owner"); const bubble = owner?.querySelector("p"); const lore = document.querySelector("#log .line:not(.owner) .md"); return Boolean(owner && bubble && lore) && getComputedStyle(owner).justifyContent === "flex-end" && getComputedStyle(bubble).backgroundColor !== "rgba(0, 0, 0, 0)" && getComputedStyle(lore).backgroundColor === "rgba(0, 0, 0, 0)"; })()`));
        await shot("conversation-bubble");
        await js(`window.__lore.event({ type: "working", task: "capture", active: true }); window.__lore.event({ type: "message", task: "capture", text: "I'll check the store is serving the new price." })`);
        await sleep(100);
        check("an open turn ends in a typing bubble labelled with what Lore is doing", await js(`(() => { const last = document.querySelector("#log").lastElementChild; return last?.classList.contains("thinking") && last.querySelectorAll(".bubble i").length === 3 && last.textContent === "Reading this…"; })()`));
        await js(`window.__lore.event({ type: "live", task: "capture", text: "Setting up your store…", status: true })`);
        check("a tool's status relabels the bubble instead of replacing what Lore said", await js(`document.querySelector("#log .thinking").textContent`) === "Setting up your store…" && /new price/.test(await js(`document.querySelector("#log").textContent`)));
        await shot("thinking-bubble");
        await js(`window.__lore.event({ type: "working", task: "capture", active: false })`);
        check("the bubble goes when the turn closes", !(await js(`Boolean(document.querySelector("#log .thinking"))`)));
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
        check("memory actions pair distinct icons with their text labels", await js(`(() => { const buttons = [...document.querySelectorAll(".sheet .btn.quiet")]; const icons = buttons.map((button) => button.querySelector("svg[aria-hidden=true]")?.innerHTML); return buttons.length === 3 && new Set(icons).size === 3 && buttons.every((button) => ["Rename", "Edit", "Draft for sale"].includes(button.textContent)); })()`));
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
