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
        // so Today must render every state it can be in — including a run that
        // started and never reported finishing.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Recent runs")`);
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
        await shot("today-recent-runs");

        // The record is read from the snapshot, not from agent memory, so it is
        // still here after a relaunch — which is the whole point of the table.
        await js(`window.__lore.show("memories")`);
        await sleep(300);
        await js(`window.__lore.show("today")`);
        await waitFor(`document.querySelector("#content").textContent.includes("Recent runs")`);
        check("history survives leaving and returning", await js(`document.querySelector("#content").textContent.includes("Saved what you approved")`));

        // An owner who has run nothing yet gets a sentence, not a bare heading.
        execFileSync("uv", ["run", "python", "-c", "from lore.store import Store\nwith Store() as s:\n s.db.execute('DELETE FROM owner_jobs')\n s.db.commit()"], { cwd: join(__dirname, "../../.."), env: process.env });
        // A "changed" event is what makes the renderer re-read the snapshot;
        // switching views alone re-renders what it already had.
        await js(`window.__lore.event({ type: "changed" })`);
        await sleep(800);
        check("an owner with no runs yet sees no Recent runs section", await js(`![...document.querySelectorAll("#content .section")].some((s) => s.textContent.includes("Recent runs"))`));
        check("the rest of Today still renders", await js(`document.querySelector("#content .strip") !== null`));
        await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Recent runs"))?.scrollIntoView()`);
        await sleep(300);
        await shot("today-recent-runs-empty");

        // APP-084: Settings reports what the scheduler holds, not that a profile file exists.
        await js(`window.__lore.show("connectors")`);
        await sleep(500);
        let rhythm = await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How often Lore reads them")).textContent`);
        check("a saved rhythm nothing runs says so, and offers Schedule", /Set for every day at 9 PM with Codex, but nothing on this Mac is running it\./.test(rhythm) && /Not scheduled/.test(rhythm) && /Schedule$/.test(rhythm), rhythm);
        await shot("settings-not-scheduled");
        mkdirSync(join(process.env.CODEX_HOME, "automations", "lore-memory-synthesis"), { recursive: true });
        writeFileSync(join(process.env.CODEX_HOME, "automations", "lore-memory-synthesis", "automation.toml"), "");
        await js(`window.__lore.event({ type: "changed" })`);
        await sleep(800);
        rhythm = await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("How often Lore reads them")).textContent`);
        check("an installed schedule reads as its rhythm, in words", /Every day at 9 PM with Codex\. Hasn't run yet\./.test(rhythm) && /Scheduled/.test(rhythm) && !/Not scheduled/.test(rhythm), rhythm);
        await shot("settings-scheduled");
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
        await waitFor(`document.querySelector("#content .price-edit input")`);
        check("Settings' Change price lands on the For Sale editor", await js(`document.querySelector("#title").textContent === "For Sale" && document.activeElement === document.querySelector("#content .price-edit input")`));
        await js(`{ const field = document.querySelector("#content .price-edit input"); field.value = "0"; field.form.requestSubmit(); }`);
        await sleep(300);
        check("zero is refused with the editor still open", await js(`document.querySelector("#status .notice.attention")?.textContent.includes("above zero") && Boolean(document.querySelector("#content .price-edit"))`));
        await js(`{ const field = document.querySelector("#content .price-edit input"); field.value = "0.75"; field.form.requestSubmit(); }`);
        await waitFor(`document.querySelector("#content").textContent.includes("Your store still charges $0.02.")`);
        check("a saved price the node does not charge yet says so on For Sale", await js(`document.querySelector("#content .store-bar").textContent.includes("$0.75") && document.querySelector("#content .store-bar").textContent.includes("Your store still charges $0.02.")`));
        await shot("store-stale-price");
        await js(`window.__lore.show("today")`);
        await sleep(400);
        check("Today offers the update as standing state, in plain words", await js(`document.querySelector("#content").textContent.includes("Your store still charges $0.02. Update it to start charging $0.75.")`));
        // Fix 5: approved work the node does not hold yet gets a standing Push, on For Sale and under Needs you.
        await js(`window.__lore.show("today")`);
        await sleep(400);
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Approve").click()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Update your store")`);
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
        check("the approved publication counts its sales", store.includes("· 1 sold"));
        check("the For Sale bar links to payouts", await js(`[...document.querySelectorAll("#content .store-bar a.link-btn")].some((a) => a.textContent === "Payouts ↗")`));
        await shot("store-sales");
        check("For Sale bar offers Update store while an approved item is not live", await js(`[...document.querySelectorAll("#content .store-bar button")].some((b) => b.textContent === "Update store")`));
        check("the heading says the one item is not live, once", await js(`document.querySelector("#content").textContent.includes("1 publication · not on your store yet") && !document.querySelector("#content").textContent.includes("Not live yet")`));
        await shot("store-unpushed");
        await js(`window.__lore.show("today")`);
        await sleep(400);
        check("Needs you carries the standing Push row", await js(`document.querySelector("#content").textContent.includes("1 approved, not on your store yet.")`));
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
        check("a taken-down item the node still serves says so", await waitFor(`document.querySelector("#content").textContent.includes("Still on your store")`));
        check("…and For Sale offers the update that removes it", await js(`[...document.querySelectorAll("#content .store-bar button")].some((b) => b.textContent === "Update store")`));
        await shot("store-removal-pending");
        await js(`window.__lore.show("today")`);
        await sleep(400);
        check("Needs you names the pending removal", await js(`document.querySelector("#content").textContent.includes("1 taken down, still on your store.")`));
        // Fix 9: a memory typed on Today joins the unfinished capture thread instead of an empty one.
        await js(`window.__lore.show("today")`);
        await js(`window.__lore.event({ type: "task", task: { version: 1, kind: "capture", title: "Capture", state: "stopped", phase: "Ready to resume", updatedAt: new Date().toISOString() } })`);
        await sleep(300);
        check("unfinished capture is listed", await js(`document.querySelector("#content").textContent.includes("Ready to resume")`));
        check("a stopped task offers Resume beside Start over", /Resume\|Start over/.test(await js(`[...document.querySelectorAll("#content .row .btn")].map((b) => b.textContent).join("|")`)));
        await js(`const i = document.querySelector("#capture-input"); i.value = "Something I learned"; document.querySelector("#composer").requestSubmit();`);
        await sleep(800);
        const eyebrow = await js(`document.querySelector("#eyebrow").textContent`);
        check("root capture joins the unfinished thread", /Ready to resume/.test(eyebrow), eyebrow);
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
        await js(`window.__lore.show("memories")`);
        await sleep(400);
        const memories = await js(`document.querySelector("#content .empty")?.textContent ?? ""`);
        check("empty Memories says what to do and offers to do it", memories.startsWith("Nothing kept yet. Say what you learned and Lore will keep it.") && await js(`document.querySelector("#content .empty button")?.textContent`) === "Add your first memory", memories);
        await shot("memories-empty");
        await js(`document.querySelector("#content .empty button").click()`);
        await sleep(300);
        check("Add your first memory lands on Today with the composer focused", await js(`document.querySelector("#title").textContent !== "Memories" && document.activeElement === document.querySelector("#capture-input")`));
        await js(`window.__lore.show("store")`);
        await sleep(600);
        check("no store: the bar offers to open one", await js(`[...document.querySelectorAll("#content .store-bar button")].some((b) => b.textContent === "Open your store")`));
        const forSale = await js(`[...document.querySelectorAll("#content .empty")].map((n) => n.textContent).join("|")`);
        check("nothing for sale: one sentence and a way to draft", /Nothing for sale yet\./.test(forSale) && await js(`[...document.querySelectorAll("#content .empty button")].some((b) => b.textContent === "Draft your first piece")`), forSale);
        check("no sales: left alone, no action", await js(`[...document.querySelectorAll("#content .empty")].find((n) => n.textContent.includes("No sales yet")).querySelector("button") === null`));
        check("every empty-state action is a real button, reachable by keyboard", await js(`[...document.querySelectorAll("#content .empty button, #content .store-bar button")].every((b) => b.tabIndex >= 0)`));
        await shot("store-empty");
        await js(`[...document.querySelectorAll("#content .empty button")].find((b) => b.textContent === "Draft your first piece").click()`);
        await sleep(300);
        check("Draft your first piece opens Memories", await js(`document.querySelector("#title").textContent`) === "Memories");
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
        check("Connect lists the vault by name; nothing to type or browse", await waitFor(`document.querySelector("dialog.sheet[open] .choice")?.textContent.includes("Edge Vault")`));
        check("Connect waits for a choice", await js(`document.querySelector("dialog.sheet[open] .btn.primary").disabled`));
        await shot("obsidian-choose");
        await js(`document.querySelector("dialog.sheet[open] .choice input").click()`);
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
        // APP-127: an owner with no apps connected is pointed at Connectors, and nothing to publish yet.
        const firstToday = await js(`document.querySelector("#content").textContent`);
        check("Today points a new owner at their apps, with nothing to publish yet", /Bring in what you've written/.test(firstToday) && !/Publish something/.test(firstToday), firstToday);
        check("…and asks nothing about agents that are not on this Mac", !/Connect your agents/.test(firstToday), firstToday);
        await shot("today-bring-in");
        await js(`[...document.querySelectorAll("#content .row")].find((r) => r.textContent.includes("Bring in what you've written")).querySelector("button").click()`);
        check("…and its button opens Connectors", await waitFor(`document.querySelector("#title").textContent === "Connectors"`));
        // Only the rows under "Where memories come from": Account also says Claude.
        const sourceRows = `[...[...document.querySelectorAll("#content section")].find((s) => s.textContent.includes("Where memories come from")).querySelectorAll(".row")]`;
        const rowOf = (name) => `${sourceRows}.find((r) => r.querySelector("b").textContent === ${JSON.stringify(name)})`;
        const textOf = (name) => `(${rowOf(name)}?.textContent ?? "")`;
        const clickOn = (name) => `${rowOf(name)}.querySelector("button").click()`;
        const primary = `document.querySelector("dialog.sheet[open] .btn.primary")`;
        await waitFor(textOf("Substack"));
        await sleep(300);
        const apps = JSON.stringify(["Obsidian", "ChatGPT", "Claude", "Substack", "Medium", "Bluesky", "Blog or newsletter", "Granola", "Notion", "Readwise"]);
        const offered = await js(`${apps}.map((n) => ${sourceRows}.find((r) => r.querySelector("b").textContent === n)?.textContent ?? "")`);
        check("every app in the catalog is offered by name, in its own words", offered.length === 10 && /Connect/.test(offered[0]) && /Import/.test(offered[1]) && /Import/.test(offered[2]) && offered.slice(3, 7).every((t) => /Connect/.test(t)) && offered.slice(7).every((t) => /Sign in/.test(t)) && !offered.some((t) => /folder|source|markdown|feed|rss|url|mcp|oauth|token/i.test(t)), offered.join(" | "));
        check("an agent that is not on this Mac is not offered", await js(`!${sourceRows}.some((r) => /^(Codex|Claude Code)$/.test(r.querySelector("b").textContent))`));
        check("every offered app carries its own mark", await js(`${apps}.every((n) => ${sourceRows}.find((r) => r.querySelector("b").textContent === n)?.querySelector("img.logo"))`));
        await shot("settings-catalog");

        // Obsidian: choose among vaults; a change to a vault that is gone leaves the working one alone.
        await js(clickOn("Obsidian"));
        check("Obsidian offers every vault it knows", await waitFor(`document.querySelectorAll("dialog.sheet[open] .choice").length === 2`));
        await js(`[...document.querySelectorAll("dialog.sheet[open] .choice")].find((c) => c.textContent.includes("Edge Vault")).querySelector("input").click()`);
        await js(`${primary}.click()`);
        check("a vault connects and says what it kept", await waitFor(`/Connected/.test(${textOf("Obsidian")}) && /2 notes kept/.test(${textOf("Obsidian")})`), await js(textOf("Obsidian")));
        await js(clickOn("Obsidian"));
        await waitFor(`document.querySelector("dialog.sheet[open]")`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] button")].find((b) => b.textContent === "Change vault").click()`);
        await waitFor(`document.querySelectorAll("dialog.sheet[open] .choice").length === 2`);
        await js(`[...document.querySelectorAll("dialog.sheet[open] .choice")].find((c) => c.textContent.includes("Stale Vault")).querySelector("input").click()`);
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
        check("with no schedule, a newsletter says it is read again only by hand", /new posts only when you choose Read again/.test(manage) && !/on its own/.test(manage), manage);
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
        check("the chosen file is offered, selected", await waitFor(`${primary}.disabled === false && document.querySelector("dialog.sheet[open] .choice input").checked`));
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
        check("with apps connected, Today offers to publish and stops asking to connect", /Publish something/.test(today) && !/Bring in what you've written/.test(today), today);
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

        await js(`document.querySelector("#feedback-open").click()`);
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
        check("the report lands", await waitFor(`document.querySelector("#status .notice")?.textContent.includes("Filed as")`));
        await sleep(1800);
        check("one owner action filed exactly one issue", relayReports.length === 1, `relay saw ${relayReports.length}`);
        await shot("feedback-filed");

        // The second reproduction: the success path used to call closeSheet(),
        // which closes whichever sheet is open — including one opened, and
        // edited, while the report was still out.
        await js(`document.querySelector("#feedback-open").click()`);
        await waitFor(`!!document.querySelector("dialog.sheet .feedback-form")`);
        await fill("A second report");
        await send();
        await sleep(300);
        await js(`window.__lore.show("memories")`);
        await waitFor(`document.querySelectorAll("#content .task-link").length >= 1`);
        await js(`document.querySelector("#content .task-link").click()`);
        check("another sheet opens while the report is in flight", await waitFor(`!!document.querySelector("dialog.sheet .btn.quiet")`));
        await sleep(2500);
        check("the in-flight report did not close the sheet opened after it", await js(`(() => { const open = [...document.querySelectorAll("dialog.sheet")]; return open.length === 1 && open[0].open === true && !open[0].classList.contains("narrow"); })()`));
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
        const opened = await js(`(() => { try { window.__lore.paste(); return "ok"; } catch (e) { return String(e && e.stack || e); } })()`);
        check("Paste opens the sheet", opened === "ok", opened);
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
        await waitFor(`Boolean(document.querySelector("#content .price-edit"))`);
        check("Change opens one editor for price and free copies", await js(`document.querySelectorAll("#content .price-edit input").length === 2 && document.querySelector("#title").textContent === "For Sale"`));
        await js(`{ const [amount, copies] = document.querySelectorAll("#content .price-edit input"); amount.value = "0.75"; copies.value = "5"; amount.form.requestSubmit(); }`);
        check("both save through the CLI", await waitFor(`window.lore.snapshot().then((s) => s.pricing.publication_usd === 0.75 && s.pricing.free_copies === 5)`));
        check("…and a live store is updated without being asked", await waitFor(`!document.querySelector("#status").textContent.includes("next push") && (document.querySelector("#content").textContent.includes("Your store is updated") || [...document.querySelectorAll("#content button")].some((b) => b.textContent === "Update store"))`));
        await shot("store-price-editor-saved");
        await js(`window.__lore.show("settings")`);
        await waitFor(`${rowOf("Price")}?.textContent.includes("first 5 copies free")`);

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
        check("clicking it opens For Sale", await waitFor(`document.querySelector("#title").textContent === "For Sale"`));
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
        check("Enter lands on Today with the text in the composer, focused", await js(`document.querySelector("#title").textContent !== "Memories" && document.querySelector("#capture-input").value === "Something Lore has never heard" && document.activeElement === document.querySelector("#capture-input")`));
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
        check("notice persists across views", await js(`document.querySelectorAll("#status .notice").length`) === 1);
      }
    } catch (error) {
      results.push(`ERROR ${error.stack}`);
    }
    console.log(results.join("\n"));
    app.exit(results.some((line) => !line.startsWith("PASS")) ? 1 : 0);
  });
});
