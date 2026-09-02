// Walks the renderer through the edge audit's two personas against a seeded scratch home.
// Usage: support/edge.sh seller|provision   (seeds LORE_HOME, then runs this under Electron)
const { app } = require("electron");
const { chmodSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
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
      } else if (scenario === "store") {
        // Fix 12: a mistyped API key is refused at sign-in, not inside the first thread.
        await waitFor(`document.body.dataset.state === "welcome" && !document.querySelector("#welcome").classList.contains("provisioning")`);
        const refusal = await js(`window.lore.login({ providerId: "anthropic", type: "api_key", secret: "sk-ant-not-a-real-key" }).then(() => "accepted", (e) => e.message)`);
        check("bogus key is refused", /not accepted/.test(refusal), refusal);
        const kept = await js(`window.lore.agentStatus().then((s) => s.credentials.length)`);
        check("bogus key is not kept", kept === 0, String(kept));

        await js(`window.__lore.signIn()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Approve what to sell")`);
        // Fix 4: with a store open, Settings offers a way back into the deploy conversation.
        await js(`window.__lore.show("settings")`);
        await sleep(600);
        const settings = await js(`document.querySelector("#content").textContent`);
        check("Settings offers Change price once a store exists", settings.includes("Change price"));
        check("Settings offers the switch to real payments while on the test network", settings.includes("Switch to real payments"));
        await js(`document.querySelector("#main").scrollTop = 1e6`);
        await sleep(200);
        await shot("settings-store");
        // Fix 5: approved work the node does not hold yet gets a standing Push, on For Sale and under Needs you.
        await js(`window.__lore.show("today")`);
        await sleep(400);
        await js(`[...document.querySelectorAll("#content button")].find((b) => b.textContent === "Approve").click()`);
        await waitFor(`document.querySelector("#content").textContent.includes("Push to your store")`);
        await js(`window.__lore.show("store")`);
        await sleep(600);
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

        // Fix 5: the Sales card no longer promises data nothing collects.
        await js(`window.__lore.show("store")`);
        await sleep(800);
        const sales = await js(`document.querySelector("#content").textContent`);
        check("Sales copy is honest", sales.includes("Sales don't show up here yet") && !sales.includes("shows up here with what it paid"));
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
