// Walks the renderer through the edge audit's two personas against a seeded scratch home.
// Usage: support/edge.sh seller|provision   (seeds LORE_HOME, then runs this under Electron)
const { app } = require("electron");
const { chmodSync, mkdirSync, writeFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { dirname, join } = require("node:path");
const scenario = process.argv.at(-1);
const S = process.env.LORE_EDGE_OUT ?? process.env.LORE_HOME;
const src = join(__dirname, "../src");
const runtime = require(join(src, "runtime.cjs"));
const realProvision = runtime.provision;
let failSetup = scenario === "provision";
// main.cjs binds provision at require time, so the stub itself must flip.
runtime.provision = async (emit) => { if (failSetup) throw new Error("uv exploded"); return realProvision(emit); };
require(join(src, "main.cjs"));

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const results = [];
function check(name, ok, detail = "") { results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`); }

app.on("browser-window-created", (/** @type {unknown} */ _event, /** @type {import("electron").BrowserWindow} */ window) => {
  const js = (code) => window.webContents.executeJavaScript(code);
  const shot = (name) => window.webContents.capturePage().then((image) => writeFileSync(join(S, `${name}.png`), image.toPNG()));
  const waitFor = async (code, tries = 40) => { for (let i = 0; i < tries; i++) { if (await js(code)) return true; await sleep(250); } return false; };
  const key = async (type, keyCode) => { window.webContents.sendInputEvent({ type, keyCode }); await sleep(30); };

  window.webContents.once("did-finish-load", async () => {
    try {
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
        const empty = await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Recent runs"))?.textContent ?? ""`);
        check("an owner with no runs yet is told so", /Nothing has run yet/.test(empty), empty);
        check("the rest of Today still renders", await js(`document.querySelector("#content .strip") !== null`));
        await js(`[...document.querySelectorAll("#content .section")].find((s) => s.textContent.includes("Recent runs"))?.scrollIntoView()`);
        await sleep(300);
        await shot("today-recent-runs-empty");
      } else if (scenario === "store") {
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Approve what to sell")`);
        // Fix 4: with a store open, Settings offers a way back into the deploy conversation.
        await js(`window.__lore.show("settings")`);
        await sleep(600);
        const settings = await js(`document.querySelector("#content").textContent`);
        check("Settings offers Change price once a store exists", settings.includes("Change price"));
        // Ledger: the payout address links to Basescan on the live network, on Settings and on the For Sale bar.
        check("Settings shows the payout address", settings.includes("0xaaaa…aaaa"));
        check("…linked to the address on Sepolia Basescan", await js(`[...document.querySelectorAll("#content a.link-btn")].some((a) => a.textContent === "Payouts ↗" && a.href === "https://sepolia.basescan.org/address/0x${"a".repeat(40)}")`));
        check("Settings offers the switch to real payments while on the test network", settings.includes("Switch to real payments"));
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await sleep(200);
        await shot("settings-store");
        // Fix 5: approved work the node does not hold yet gets a standing Push, on For Sale and under Needs you.
        await js(`window.__lore.show("today")`);
        await sleep(400);
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Approve").click()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Push to your store")`);
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
        check("For Sale bar offers Push while an approved item is not live", await js(`[...document.querySelectorAll("#content .store-bar button")].some((b) => b.textContent === "Push to your store")`));
        check("the item reads Not live yet", await js(`document.querySelector("#content").textContent.includes("Not live yet")`));
        check("the section hint agrees", await js(`document.querySelector("#content").textContent.includes("1 not on your store yet")`));
        await shot("store-unpushed");
        await js(`window.__lore.show("today")`);
        await sleep(400);
        check("Needs you carries the standing Push row", await js(`document.querySelector("#content").textContent.includes("1 approved, not on your store yet.")`));
        // Fix 9: a memory typed on Today joins the unfinished capture thread instead of an empty one.
        await js(`window.__lore.show("today")`);
        await js(`window.__lore.event({ type: "task", task: { version: 1, kind: "capture", title: "Capture", state: "stopped", phase: "Ready to resume", updatedAt: new Date().toISOString() } })`);
        await sleep(300);
        check("unfinished capture is listed", await js(`document.querySelector("#content").textContent.includes("Ready to resume")`));
        await js(`const i = document.querySelector("#capture-input"); i.value = "Something I learned"; document.querySelector("#composer").requestSubmit();`);
        await sleep(800);
        const eyebrow = await js(`document.querySelector("#eyebrow").textContent`);
        check("root capture joins the unfinished thread", /Ready to resume/.test(eyebrow), eyebrow);
        await shot("root-capture-joined");
        await js(`window.__lore.openTask("deploy")`);
        const deployLog = await js(`document.querySelector("#log").textContent`);
        check("a completed deploy opens with fresh history", !deployLog.includes("OLD COMPLETED DEPLOY"), deployLog);
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
        check("stage two swaps the heading and the buttons", await js(`document.querySelector("#request .q").textContent`) === "Finish in your browser, then come back here." && await buttons() === "I got stuck|Done");
        check("the card keeps its size between stages", await js(`document.querySelector("#request form").offsetHeight`) === before);
        await js(`document.querySelector("#request").scrollIntoView({ block: "center" }); true`);
        await shot("open-stage-two");
        await js(`document.querySelector("#request form").requestSubmit()`);
        await sleep(200);
        check("Done closes the card and echoes the owner", !(await js(`Boolean(document.querySelector("#request form"))`)) && await js(`document.querySelector("#log").textContent.endsWith("Done")`));
        await js(`window.__lore.preview({ type: "open", id: "preview-open-2", task: null, title: "See the payment land", url: "https://sepolia.basescan.org/address/0x1", note: "Token Transfers shows it." })`);
        await js(`document.querySelector("#request .actions button").click()`);
        await sleep(200);
        check("Not now closes the card and echoes the owner", !(await js(`Boolean(document.querySelector("#request form"))`)) && await js(`document.querySelector("#log").textContent.endsWith("Not now")`));

        // Fix 1, seller: approve the last draft with no store. The confirmation must be visible on the Today root.
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Approve").click()`);
        await waitFor(`document.querySelectorAll("#content .draft-title").length === 1`);
        check("approved the edited draft", await js(`document.querySelectorAll("#content .draft-title").length`) === 1);
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Skip").click()`);
        await waitFor(`document.querySelector("#status .notice")`);
        const notice = await js(`document.querySelector("#status .notice")?.textContent ?? ""`);
        check("approval confirmation is visible outside a thread", notice.includes("Approved. It goes on sale the moment you open a store."), notice);
        check("confirmation is not styled as a problem", !(await js(`document.querySelector("#status .notice").classList.contains("attention")`)));
        check("approved title carried the edit", await js(`window.lore.snapshot().then((s) => s.publications.items.map((i) => i.title).join("|"))`) === "Edited by the owner");
        await shot("seller-approved-notice");
        await js(`document.querySelector("#status .notice .dismiss").click()`);
        check("notice dismisses", await js(`document.querySelectorAll("#status .notice").length`) === 0);

        // Ledger: with no store there is nothing to read, and the section says so without a probe.
        await js(`window.__lore.show("store")`);
        await sleep(800);
        const sales = await js(`document.querySelector("#content").textContent`);
        check("Sales is empty without a store", sales.includes("No sales yet."), sales.slice(-160));
        await shot("store");

        // Fix 1, technical: a failing CLI call on Memories surfaces as an attention notice instead of vanishing.
        await js(`window.__lore.show("memories")`);
        await waitFor(`document.querySelectorAll("#content .task-link").length >= 1`);
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
