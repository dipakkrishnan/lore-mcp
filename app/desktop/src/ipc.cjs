// APP-267: the main process's logic, behind a seam plain node reaches. main.cjs builds the Electron bundle this factory
// takes (ipcMain, the shell, the window, the agent once it exists, the dock badge) and calls it; node --test hands it
// fakes. Nothing here touches Electron at load, so `require("./ipc.cjs")` works outside the app.
const { existsSync } = require("node:fs");
const { appendFile } = require("node:fs/promises");
const { dirname, isAbsolute, join } = require("node:path");
const runtime = require("./runtime.cjs");
const { transcribe } = require("./dictation.cjs");
const sales = require("./sales.cjs");
const reading = require("./reading.cjs");
const checkin = require("./checkin.cjs");
const { FirstRun } = require("./firstrun.cjs");
const { AgentApps } = require("./agents.cjs");
const { checkAttachments } = require("./attachments.cjs");
const { ownerGates } = require("./owner.cjs");

const TASKS = new Set(["capture", "setup", "publish", "deploy", "evening"]);
/** What the renderer may report: that the usage notice was on screen, and that the app opened. */
const USAGE = new Set(["noticed", "app.installed", "app.opened"]);
const LOGINS = new Set(["anthropic:oauth", "anthropic:api_key", "openai-codex:oauth", "openai:api_key"]);
const FIRST_RUN_STEPS = new Set(["apps", "agent", "store", "link", "saved", "skipped"]);

const NOTHING_TO_ASK = "Nothing new to ask about";
const COULD_NOT_LOOK = "Couldn't look over today. Lore will try again next time";

/** Reading the ledger asks Cloudflare, so once a minute is plenty; coming back to the app checks at once. */
const SALES_EVERY_MS = 60_000;

/**
 * @typedef {object} MainProcess The pieces of the running app the logic needs, real in main.cjs and fakes under node --test.
 * @property {import("electron").IpcMain} ipcMain
 * @property {Pick<import("electron").Shell, "openExternal" | "openPath" | "showItemInFolder">} shell
 * @property {Pick<import("electron").Clipboard, "writeText">} clipboard
 * @property {Pick<import("electron").Dialog, "showOpenDialog">} dialog
 * @property {Pick<import("electron").SystemPreferences, "askForMediaAccess">} systemPreferences
 * @property {typeof import("electron").BrowserWindow} BrowserWindow
 * @property {{userData: string, temp: string, home: string}} paths Electron's app.getPath, read once.
 * @property {typeof sales.notify} notify One Mac notification.
 * @property {(event: AgentEvent) => void} emit To the window, if one is open.
 * @property {(event: AgentEvent) => void} reveal Bring the window forward, then show what a notification was about.
 * @property {() => import("electron").BrowserWindow | undefined} getWindow
 * @property {() => import("electron").BrowserWindow} createWindow
 * @property {() => LoreAgentInstance | undefined} getAgent The agent, once setup has finished.
 * @property {InstanceType<typeof import("./owner.cjs").OwnerRequests>} requests The cards waiting on the owner's answer (APP-062).
 * @property {InstanceType<typeof reading.Badge>} badge The dock's red number.
 * @property {InstanceType<typeof import("./bids.cjs").BidWatch>} bids Open bids the owner's memories answer (APP-274).
 * @property {InstanceType<typeof import("./updates.cjs").Updates>} updates
 * @property {InstanceType<typeof import("./appearance.cjs").Appearance>} appearance
 * @property {(loreHome: string, outgoing: InstanceType<typeof import("./state.cjs").Outgoing>) => Promise<void>} boot Set up again after a failed start.
 * @property {(listener: () => void) => void} onFocus Called whenever the app comes to the front.
 */

/** @param {MainProcess} main @param {typeof import("./state.cjs")} [bridge] state.cjs, the CLI bridge; a test hands in a fake. */
function Ipc({ ipcMain, shell, clipboard, dialog, systemPreferences, BrowserWindow, paths, notify, emit, reveal, getWindow, createWindow, getAgent, requests, badge, bids, updates, appearance, boot, onFocus }, bridge = require("./state.cjs")) {
  const { lore, listRoutines, runRoutine, changeRoutine, addRoutine, editRoutine, switchSource, openable, readState, readSales, readViews, searchMemories, stageBidAnswer, readMemory, readGists, creditMemories, judgeMemories, renameMemory, editMemory, deleteMemory, captureMemories, previewPage, setPrice, setFreeCopies, newCollection, addToCollection, renameCollection, priceCollection, removeFromCollection, deleteCollection, candidates, decide, extrasCandidates, decideExtras, approveExtras, reportFeedback, listStore, cardStatus, connectCards, switchCards, listingStatus, sourceCatalog, sourceChoices, connectSource, signIn, readSource, removeSource, listAgents, connectAgent, agentKey, disconnectAgent, agentAddress, allowSignIn, denySignIn, openStore, storeOnline, cloudflareSignIn, saveProfile, ATTENDED_KEYS, STORE } = bridge;
  /** The agent, once setup has finished. */
  function ready() {
    const agent = getAgent();
    if (!agent) throw new Error("Lore is still setting up on this Mac");
    return agent;
  }
  /** The connect or sign-in in flight, if any; closing its sheet stops it. @type {AbortController | undefined} */
  let connecting;
  const newMemories = new reading.Ready(join(paths.userData, "memories-ready.json"), badge.part("memories"));
  const suggestions = new reading.Suggestions(join(paths.userData, "collection-suggestions.json"));
  /** Where the first-run chat stands (APP-215). */
  const firstRun = new FirstRun(join(paths.userData, "first-run.json"));
  /** Which memories the owner has had on screen, so Inventory marks the rest New (APP-212). */
  const seenMemories = new reading.Seen(join(paths.userData, "memories-seen.json"));
  /** The evening check-in waiting for the owner, if Lore found something worth asking (AUT-008). */
  const checkIns = new checkin.CheckIns(join(paths.userData, "check-in.json"), badge.part("checkin"));

  /** The Cloudflare sign-in waiting on the owner's browser, if any: its page, to open again, and how to stop it.
   * @type {{url: string, stop: AbortController} | null} */
  let signingIn = null;

  /** Sign in to Cloudflare in the browser, wherever the store goes online, with the page reopenable and the wait
   * cancellable from the app until it ends; it always ends, signed in, cancelled, failed or timed out.
   * @param {string} loreHome @param {(url: string) => void} [opened] */
  async function signInToCloudflare(loreHome, opened) {
    const current = { url: "", stop: new AbortController() };
    signingIn = current;
    try {
      return await cloudflareSignIn(loreHome, (url) => {
        current.url = url;
        void shell.openExternal(url);
        emit({ type: "signin", pending: true });
        opened?.(url);
      }, { signal: current.stop.signal });
    } finally {
      if (signingIn === current) signingIn = null;
      emit({ type: "signin", pending: false });
    }
  }

  /** @param {AgentRequest["type"]} type @param {Record<string, unknown>} payload @param {AbortSignal} [signal] */
  function request(type, payload, signal) {
    return requests.ask(type, payload, getAgent()?.activeTask, signal);
  }

  /** Every channel the renderer may invoke, each handled once. ipc-contract.test.cjs reads this file to prove preload and
   * the renderer agree with it.
   * @param {string} loreHome @param {InstanceType<typeof import("./routines.cjs").Schedule>} schedule @param {InstanceType<typeof import("./agents.cjs").Watch>} watch @param {InstanceType<typeof import("./state.cjs").Outgoing>} outgoing */
  function registerIpc(loreHome, schedule, watch, outgoing) {
    ipcMain.handle("snapshot:read", async () => {
      const [state, bidMatches, bidBoard] = await Promise.all([readState(loreHome), bids.matches(), bids.board()]);
      storeAddress = state.node.url;
      inboxAddress = state.node.agents ?? null;
      return { ...state, bidMatches, bidBoard };
    });
    ipcMain.handle("dictation:permission", () => systemPreferences.askForMediaAccess("microphone"));
    ipcMain.handle("update:status", () => updates.update);
    ipcMain.handle("update:check", () => updates.check());
    ipcMain.handle("update:install", () => updates.install());
    ipcMain.handle("dictation:transcribe", (_event, /** @type {ArrayBuffer} */ wav) => transcribe({ ...runtime.whisper, dir: paths.temp }, Buffer.from(wav)));
    ipcMain.handle("setup:retry", () => (getAgent() ? undefined : boot(loreHome, outgoing)));
    ipcMain.handle("agent:status", () => getAgent()?.status() ?? { credentials: [] });
    ipcMain.handle("agent:prompt", async (_event, input) => {
      if (!input || typeof input.text !== "string" || input.text.length > 100_000 || !TASKS.has(input.task) || (input.from !== undefined && !TASKS.has(input.from)) || (input.memory !== undefined && !Number.isInteger(input.memory)) || (input.source !== undefined && typeof input.source !== "string")) {
        throw new Error("Invalid prompt");
      }
      // The agent reads copies, inside its own sandbox; never the owner's files where they lie.
      const files = await ready().attach(await checkAttachments(loreHome, input.files ?? [], hidden()));
      // The owner's first word to a check-in answers it, once the turn went through; one that failed leaves it waiting.
      const turn = ready().prompt(input.text, input.task, input.from, input.memory, input.source, files);
      return input.task === "evening" ? turn.then(() => checkIns.answer()) : turn;
    });
    ipcMain.handle("agent:history", (_event, task) => {
      if (!TASKS.has(task)) throw new Error("Invalid task");
      return ready().history(task);
    });
    ipcMain.handle("agent:tasks", () => ready().tasks());
    ipcMain.handle("agent:restart", (_event, task) => {
      if (!TASKS.has(task)) throw new Error("Invalid task");
      ready().restart(task);
    });
    ipcMain.handle("agent:respond", (_event, response) => requests.answer(response));
    ipcMain.handle("auth:login", (_event, input) => {
      if (!input || !LOGINS.has(`${input.providerId}:${input.type}`)) throw new Error("Unsupported sign-in");
      if (input.secret !== undefined && typeof input.secret !== "string") throw new Error("Invalid key");
      return ready().login(input.providerId, input.type, input.secret).then((auth) => {
        void lore(loreHome, ["telemetry", "record", "signin.completed"]).catch(() => undefined);
        return auth;
      });
    });
    ipcMain.handle("usage:record", (_event, name, step) => {
      // The first-run chat's steps are the one event the renderer sends with a value, and only one of these.
      if (name === "firstrun.step" && FIRST_RUN_STEPS.has(step)) return lore(loreHome, ["telemetry", "record", name, step]).then(() => undefined);
      if (!USAGE.has(name) || step !== undefined) throw new Error("Unknown usage event");
      return lore(loreHome, name === "noticed" ? ["telemetry", "noticed"] : ["telemetry", "record", name]).then(() => undefined);
    });
    ipcMain.handle("telemetry:set", (_event, on) => lore(loreHome, ["telemetry", on === true ? "on" : "off"]).then(() => undefined));
    ipcMain.handle("telemetry:log", async () => {
      const log = join(loreHome, "usage.log");
      await appendFile(log, "");
      return shell.openPath(log);
    });
    ipcMain.handle("auth:cancel", () => getAgent()?.cancelLogin());
    ipcMain.handle("auth:logout", (_event, providerId) => {
      if (typeof providerId !== "string") throw new Error("Invalid provider");
      return ready().logout(providerId);
    });
    ipcMain.handle("search:query", (_event, query) => {
      if (typeof query !== "string" || query.length > 200) throw new Error("Invalid search");
      return searchMemories(loreHome, query);
    });
    ipcMain.handle("memory:read", (_event, id) => readMemory(loreHome, id));
    // APP-282: the file a memory was read from, shown in Finder; the path is the store's, so the page can only name an id.
    ipcMain.handle("memory:reveal", async (_event, id) => {
      const { source_path: path } = await readMemory(loreHome, id);
      const file = path.startsWith("~/") ? join(paths.home, path.slice(2)) : path;
      if (isAbsolute(file) && existsSync(file)) shell.showItemInFolder(file);
    });
    ipcMain.handle("memory:gists", () => readGists(loreHome));
    ipcMain.handle("memory:rename", (_event, id, title) => {
      if (typeof title !== "string") throw new Error("Invalid title");
      return renameMemory(loreHome, id, title);
    });
    ipcMain.handle("memory:edit", (_event, id, content) => {
      if (typeof content !== "string") throw new Error("Invalid content");
      return editMemory(loreHome, id, content);
    });
    ipcMain.handle("memory:delete", async (_event, id) => {
      const deleted = await deleteMemory(loreHome, id);
      await newMemories.forget(deleted.deleted);
      return deleted;
    });
    ipcMain.handle("memory:paste", (_event, input) => {
      if (!input || typeof input.title !== "string" || typeof input.content !== "string") throw new Error("Invalid memory");
      return captureMemories(loreHome, [{ title: input.title, content: input.content, source_path: "pasted" }]);
    });
    ipcMain.handle("publication:candidates", () => candidates(loreHome));
    ipcMain.handle("publication:preview", async (_event, input) => {
      const { candidate, store } = input ?? {};
      if (!candidate || typeof candidate.teaser !== "string" || !store || typeof store.priceUsd !== "number" || typeof store.origin !== "string") {
        throw new Error("Invalid preview");
      }
      // Its own window, not a frame in the app: a frame inherits the app's style policy and the page's inline styles never apply.
      const preview = new BrowserWindow({
        parent: getWindow() ?? undefined,
        width: 880,
        height: 760,
        backgroundColor: "#f7f3ea",
        webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
      });
      preview.webContents.on("will-navigate", (event) => event.preventDefault());
      preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      await preview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(await previewPage(candidate, store))}`);
    });
    ipcMain.handle("publication:decide", (_event, input) => {
      if (!input || typeof input.approve !== "boolean" || !input.original || typeof input.original !== "object" || !input.candidate || typeof input.candidate !== "object") {
        throw new Error("Invalid decision");
      }
      return decide(loreHome, input.original, input.candidate, input.approve);
    });
    ipcMain.handle("publication:extras", () => extrasCandidates(loreHome));
    ipcMain.handle("publication:decide-extras", async (_event, input) => {
      if (!input || typeof input.approve !== "boolean" || !input.original || typeof input.original !== "object" || !input.extras || typeof input.extras !== "object") {
        throw new Error("Invalid decision");
      }
      await decideExtras(loreHome, input.original, input.extras, input.approve);
      if (input.approve) outgoing.mark([input.extras.publication_id]);
    });
    ipcMain.handle("publication:approve-extras", async (_event, decisions) => {
      if (!Array.isArray(decisions) || !decisions.length || !decisions.every((d) => d && typeof d.original === "object" && d.original && typeof d.extras === "object" && d.extras)) {
        throw new Error("Invalid decisions");
      }
      await approveExtras(loreHome, decisions);
      outgoing.mark(decisions.map((decision) => decision.extras.publication_id));
      const pushed = await outgoing.push();
      if (pushed && !getWindow()?.isFocused()) {
        notify({ title: "Your store is updated", body: `${decisions.length} pieces have their new pages.` }, () => {
          if (!getWindow()) createWindow();
          getWindow()?.show();
          getWindow()?.focus();
        });
      }
      return pushed;
    });
    ipcMain.handle("publication:revoke", async (_event, id) => {
      if (!Number.isInteger(id) || id < 1) throw new Error("Invalid publication");
      await lore(loreHome, ["publication", "revoke", String(id)], "");
      await outgoing.push();
    });
    // A newer store goes out only from its own Update, where the store shows (APP-231); Update store pushes what waits.
    ipcMain.handle("store:push", (_event, latest) => outgoing.push({ latest: latest === true }));
    ipcMain.handle("store:sales", () => readSales(loreHome));
    ipcMain.handle("store:views", () => readViews(loreHome));
    ipcMain.handle("pricing:set", (_event, amount) => setPrice(loreHome, amount));
    ipcMain.handle("pricing:free-copies", (_event, count) => setFreeCopies(loreHome, count));
    ipcMain.handle("collection:new", (_event, title) => newCollection(loreHome, typeof title === "string" ? title : undefined));
    ipcMain.handle("collection:add", (_event, id, input) => {
      if (!input || typeof input !== "object") throw new Error("Invalid collection input");
      return addToCollection(loreHome, id, input);
    });
    ipcMain.handle("collection:rename", (_event, id, title) => {
      if (typeof title !== "string") throw new Error("Invalid title");
      return renameCollection(loreHome, id, title);
    });
    ipcMain.handle("collection:price", (_event, id, amount) => priceCollection(loreHome, id, amount));
    ipcMain.handle("collection:remove", (_event, id, piece) => removeFromCollection(loreHome, id, piece));
    ipcMain.handle("collection:delete", (_event, id) => deleteCollection(loreHome, id));
    ipcMain.handle("home:reveal", () => shell.openPath(loreHome));
    ipcMain.handle("feedback:report", (_event, input) => {
      if (!input || typeof input.title !== "string" || typeof input.email !== "string" || typeof input.description !== "string") {
        throw new Error("Invalid feedback report");
      }
      return reportFeedback(loreHome, input);
    });
    ipcMain.handle("listing:act", (_event, action) => listStore(loreHome, action));
    ipcMain.handle("cards:status", () => cardStatus(loreHome));
    ipcMain.handle("cards:connect", async () => {
      const { url } = await connectCards(loreHome);
      // Stripe's hosted form doesn't run inside the app getWindow().
      if (url.startsWith("https://") || url.startsWith("http://localhost")) await shell.openExternal(url);
    });
    ipcMain.handle("cards:switch", (_event, account) => switchCards(loreHome, account));
    ipcMain.handle("listing:status", () => listingStatus(loreHome));
    ipcMain.handle("sources:catalog", () => sourceCatalog(loreHome));
    ipcMain.handle("sources:choices", (_event, app) => sourceChoices(loreHome, app));
    /** @template T @param {(signal: AbortSignal) => Promise<T>} work */
    async function connect(work) {
      connecting?.abort();
      const current = (connecting = new AbortController());
      try {
        return await work(current.signal);
      } finally {
        if (connecting === current) connecting = undefined;
      }
    }
    /** @template {{name: string, connector?: string | null, added?: number}} T @param {T} read */
    const through = (read) => readThrough(loreHome, read);
    ipcMain.handle("sources:connect", (_event, input) => connect((signal) => connectSource(loreHome, input, signal)).then(through));
    ipcMain.handle("sources:sign-in", (_event, app) => connect((signal) => signIn(loreHome, app, (url) => void shell.openExternal(url), signal)).then(through));
    ipcMain.handle("sources:cancel", () => connecting?.abort());
    ipcMain.handle("sources:read", async (_event, name) => (await readSource(loreHome, name)).map(through));
    ipcMain.handle("ready:runs", () => newMemories.runs());
    ipcMain.handle("suggestions:list", () => suggestions.list());
    ipcMain.handle("suggestions:drop", (_event, title) => suggestions.drop(title));
    ipcMain.handle("ready:seen", () => newMemories.seen());
    ipcMain.handle("ready:clear", () => newMemories.clear());
    ipcMain.handle("ready:dismiss", (_event, runs) => newMemories.dismiss(runs));
    ipcMain.handle("memory:unseen", (_event, newest) => {
      if (!Number.isInteger(newest) || newest < 0) throw new Error("Invalid memory");
      return seenMemories.read(newest);
    });
    ipcMain.handle("memory:seen", async (_event, ids) => {
      await seenMemories.add(reading.seenIds(ids));
    });
    ipcMain.handle("checkin:waiting", () => checkIns.waiting());
    ipcMain.handle("bids:dismiss", async (_event, id) => {
      await bids.dismiss(String(id));
      emit({ type: "changed" });
    });
    // A stranger wrote the question, so the model drafting the answer gets no tools: the app reads the matched memories,
    // hands their text over, and stages a draft from the words it gets back, tied to the bid, waiting on the owner's card.
    ipcMain.handle("bids:draft", async (_event, id) => {
      const match = await bids.find(String(id));
      if (!match) throw new Error("That bid has ended");
      const memories = await Promise.all(match.memories.map((memory) => readMemory(loreHome, memory.id)));
      const words = await ready().draftBid(match, memories);
      if (!words) throw new Error("Lore couldn't draft an answer from those memories. Try again.");
      await stageBidAnswer(loreHome, match, words);
      emit({ type: "changed" });
    });
    ipcMain.handle("checkin:dismiss", () => checkIns.expire().then(closeCheckIn));
    // APP-200: the Automations tab reads and changes routines through the CLI, then the clock looks again. Run now waits
    // its turn behind any run under way, so the owner's and the clock's never overlap.
    ipcMain.handle("routines:list", () => listRoutines(loreHome));
    ipcMain.handle("routines:noticed", () => lore(loreHome, ["automation", "noticed"]).then(() => undefined));
    ipcMain.handle("routines:run", async (_event, id) => {
      const routine = (await listRoutines(loreHome)).find((each) => each.id === id);
      if (!routine) throw new Error("Lore does not run that one");
      const before = await told();
      await schedule.runNow(routine);
      await getAgent()?.settled();
      const done = /** @type {Routine} */ ((await listRoutines(loreHome)).find((each) => each.id === id));
      // The owner asked, so they hear it finished: here if they are away, unless the run already told them what it found.
      if (!getWindow()?.isFocused() && (await told()) === before) {
        notify({ title: `“${done.name}” is done`, body: done.result || "Nothing new" }, () => reveal({ type: "show", view: "automations" }));
      }
      return done;
    });
    ipcMain.handle("routines:change", async (_event, id, action, when) => {
      await changeRoutine(loreHome, id, action, when);
      void schedule.check();
    });
    ipcMain.handle("routines:add", async (_event, text, when, title) => {
      const added = await addRoutine(loreHome, text, when, title);
      void schedule.check();
      return added;
    });
    ipcMain.handle("routines:edit", (_event, id, text, title) => editRoutine(loreHome, id, text, title));
    ipcMain.handle("sources:switch", (_event, name, on) => switchSource(loreHome, name, on === true));
    ipcMain.handle("sources:remove", (_event, name, keep) => removeSource(loreHome, name, keep === true));
    // APP-207: the owner's personal agents, each a key to their own store, and what they saved brought in on request.
    // Like collecting, asking the store is one at a time: a sheet waiting on a save and Connectors share one answer.
    /** @type {Promise<AgentEntry[]> | null} */
    let listing = null;
    ipcMain.handle("agents:list", () => (listing ??= listAgents(loreHome).finally(() => { listing = null; })));
    ipcMain.handle("agents:connect", (_event, input) => connectAgent(loreHome, input));
    ipcMain.handle("agents:key", (_event, source) => agentKey(loreHome, source));
    ipcMain.handle("agents:disconnect", (_event, source, keep) => disconnectAgent(loreHome, source, keep === true));
    ipcMain.handle("agents:check", () => watch.check());
    ipcMain.handle("agents:address", () => agentAddress(loreHome));
    ipcMain.handle("agents:allow", (_event, input) => allowSignIn(loreHome, input));
    ipcMain.handle("agents:deny", (_event, id) => denySignIn(loreHome, id));
    // APP-216: which of the owner's agent apps are on this Mac, and opening one by its id.
    const agentApps = new AgentApps(["/Applications", join(paths.home, "Applications")], (path) => shell.openPath(path));
    ipcMain.handle("agents:installed", () => agentApps.installed());
    ipcMain.handle("agents:open", (_event, id) => agentApps.open(id));
    // APP-215: the first-run chat's place, and its store going online for the owner's agents on the owner's tap, signing
    // in to Cloudflare first in the browser when it has to.
    ipcMain.handle("firstrun:read", () => firstRun.read());
    ipcMain.handle("firstrun:write", (_event, next) => firstRun.write(next));
    ipcMain.handle("appearance:read", () => appearance.read());
    ipcMain.handle("appearance:set", (_event, choice) => appearance.set(choice));
    ipcMain.handle("store:online", async () => {
      try {
        await storeOnline(loreHome);
      } finally {
        inboxAddress = undefined;
        emit({ type: "changed" });
      }
    });
    // A sign-in waiting on the browser: its page opened again, or the wait stopped, from the card that started it.
    ipcMain.handle("signin:reopen", () => signingIn?.url && shell.openExternal(signingIn.url));
    ipcMain.handle("signin:cancel", () => signingIn?.stop.abort());
    ipcMain.handle("clipboard:write", (_event, text) => {
      if (typeof text !== "string" || text.length > 100_000) throw new Error("Nothing to copy");
      clipboard.writeText(text);
    });
    // The Files and Folders pane, where the owner grants the read a folder needs.
    ipcMain.handle("settings:privacy", () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"));
    ipcMain.handle("folders:pick", async () => {
      const window = getWindow();
      if (!window) return null;
      const { filePaths } = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
      return filePaths[0] ?? null;
    });
    ipcMain.handle("files:pick", async () => {
      const window = getWindow();
      if (!window) return [];
      const { filePaths } = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"] });
      return filePaths;
    });
  }

  /** Whatever a connect, a read or a routine brought in from an app, Lore reads through in the background.
   * @template {{name: string, connector?: string | null, added?: number}} T @param {string} loreHome @param {T} read */
  function readThrough(loreHome, read) {
    void queueReadings(loreHome, [read]).then((shown) => shown && emit({ type: "ready" }));
    return read;
  }

  /** Put each app's new items in line to be read. What an agent saved is on Today at once, as the memories it wrote; a
   * reading after only judges them, and writes none of its own beside them. Resolves to whether Today has a new card, for the caller to tell the window, once.
   * @param {string} loreHome @param {Array<{name: string, connector?: string | null, added?: number, memories?: Array<{id: number, title: string}>}>} reads */
  async function queueReadings(loreHome, reads) {
    if (!reads.some((read) => read.added)) return false;
    const apps = await sourceCatalog(loreHome).catch(() => []);
    let shown = false;
    for (const read of reads) {
      const next = reading.worthReading(read, apps);
      if (!next) continue;
      if (next.by.kind === "agent") {
        if (!read.memories?.length) continue;
        await showSaved(reading.saved(next, read.memories));
        shown = true;
        getAgent()?.synthesize({ ...next, judge: read.memories });
        continue;
      }
      getAgent()?.synthesize(next);
    }
    return shown;
  }

  /** APP-233: an agent's saves, on Today and in a notification that opens them in Inventory. @param {ReadyRun} run */
  async function showSaved(run) {
    await newMemories.add(run);
    const source = run.by && { id: run.by.id, label: run.by.label };
    notify(reading.announcement(run), () => reveal({ type: "show", view: "inventory", source }));
  }

  /** What Lore last told the owner about, so a run can tell whether it already did. */
  async function told() {
    return JSON.stringify([(await newMemories.runs())[0], (await checkIns.latest())?.at]);
  }

  /** What the app does with each kind of routine's run, by the `kind` the CLI names. A new kind is one entry here.
   * @type {Record<Routine["kind"], (loreHome: string, ran: RoutineRun) => void | Promise<void>>} */
  const AFTER_RUN = {
    read: async (loreHome, ran) => void (await queueReadings(loreHome, ran.reads ?? [])),
    // The check-in retires one from an earlier day the owner never answered, and asks at most once a day. It looks over
    // what came in only if anything did; a day with nothing costs no model at all. A missed one the CLI already recorded.
    checkin: async (loreHome, { items = [], mark, missed }) => {
      if (missed) return;
      await checkIns.retire().then(closeCheckIn);
      if (await checkIns.askedToday()) return;
      if (!items.length) await recordCheckIn(loreHome, NOTHING_TO_ASK, mark);
      else if (getAgent()) ready().checkIn({ items, mark });
      else await recordCheckIn(loreHome, COULD_NOT_LOOK);
    },
    // One of the owner's own: their sentence, read through quietly like a connected app, into private memories.
    ask: (_loreHome, { routine, ask = "" }) => getAgent()?.synthesize(reading.asking(routine, ask))
  };

  /** What the check-in came to; with `mark`, the newest item its model judged, so the next one starts after it.
   * @param {string} loreHome @param {string} result @param {number} [mark] */
  function recordCheckIn(loreHome, result, mark) {
    return lore(loreHome, ["automation", "result", "checkin", result, ...(mark === undefined ? [] : ["--mark", String(mark)])]);
  }

  /** A check-in that went unanswered takes its thread off Today with it. @param {boolean} expired */
  function closeCheckIn(expired) {
    if (!expired) return;
    try {
      getAgent()?.restart("evening");
    } catch {}
  }

  /** Run one routine through the CLI, then do what its kind asks with what it brought. @param {string} loreHome @param {Routine} routine */
  async function runNow(loreHome, routine) {
    const ran = await runRoutine(loreHome, routine.id);
    await AFTER_RUN[ran.routine.kind](loreHome, ran);
    emit({ type: "changed" });
  }

  /** The store's address as the last snapshot read it; undefined until one has been read. @type {string | null | undefined} */
  let storeAddress;

  /** Only a store that went online has a ledger or an inbox; until then Lore never asks. Its config, wherever it is (the CLI
   * finishes an unfinished install, or rebuilds a store set up inside Lore's home, on the first read), and its recorded
   * address: a deploy that stopped partway (an email not verified yet) leaves a config with no store behind it.
   * @param {string} loreHome */
  async function hasStore(loreHome) {
    if (![join(STORE, "wrangler.jsonc"), join(STORE, "node_modules", ".bin", "wrangler"), join(loreHome, "node", "wrangler.jsonc")].some((path) => existsSync(path))) return false;
    if (storeAddress === undefined) storeAddress = (await readState(loreHome).catch(() => null))?.node.url;
    return Boolean(storeAddress);
  }

  /** Where the owner's agents save as the last snapshot read it; undefined until one has been read. @type {string | null | undefined} */
  let inboxAddress;

  /** Only a store online for the owner's agents has an inbox, on their own Cloudflare or hosted by Lore (XC-088).
   * @param {string} loreHome */
  async function hasInbox(loreHome) {
    if (inboxAddress === undefined) inboxAddress = (await readState(loreHome).catch(() => null))?.node.agents ?? null;
    return Boolean(inboxAddress);
  }

  /** A Mac notification for every new sale while Lore is open. The last one announced is kept on disk,
   * so a relaunch never repeats one and a first look at an old store doesn't replay its history.
   * @param {string} loreHome */
  function watchSales(loreHome) {
    const seenFile = join(paths.userData, "sales-seen.json");
    let checking = false;
    const check = async () => {
      // Only a deployed store has a ledger; skip the CLI entirely until one exists.
      if (checking) return;
      checking = true;
      if (!(await hasStore(loreHome))) {
        checking = false;
        return;
      }
      try {
        const seen = await sales.readSeen(seenFile);
        // A store nobody has bought from or connected to yet has no ledger table: that is an empty
        // ledger, and remembering it as read is what lets the very first sale be announced.
        /** @type {Sale[]} */
        const rows = await readSales(loreHome).catch((error) => {
          if (/no such table/i.test(String(error?.message))) return [];
          throw error;
        });
        const fresh = sales.unseen(rows, seen);
        // Remembered before announcing: a crash in between loses one banner rather than repeating it.
        if (rows.length || !seen) await sales.writeSeen(seenFile, sales.marker(rows));
        for (const words of sales.announcements(fresh)) {
          notify(words, () => {
            if (!getWindow()) createWindow();
            getWindow()?.show();
            getWindow()?.focus();
            emit({ type: "show", view: "store" });
          });
        }
        if (fresh.length) emit({ type: "sold" });
      } catch {
        // Offline or signed out of Cloudflare: the next check tries again.
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(() => void check(), SALES_EVERY_MS);
    onFocus(() => void check());
    void check();
    return { check, stop: () => clearInterval(timer) };
  }

  /** Folders the agent may never read: the app's own data, where the launch keys live, and the store's code. */
  function hidden() {
    return [paths.userData, dirname(ATTENDED_KEYS), STORE];
  }

  /** What the agent calls back into the app for: the owner's cards, what a reading or check-in came to, and the job
   * ledger. Read at call time: the agent does not exist yet while these options are built.
   * @param {string} loreHome @param {InstanceType<typeof import("./state.cjs").Outgoing>} outgoing
   * @param {(value: unknown) => value is ProposedMemory[]} validEntries
   * @returns {Omit<LoreAgentOptions, "loreHome" | "skillsDir" | "binDir" | "hidden" | "credentials" | "emit">} */
  function agentCallbacks(loreHome, outgoing, validEntries) {
    return {
      askUser: async (questions) =>
        /** @type {Record<string, string>} */ (await request("question", { questions })),
      proposeMemories: async (entries) => {
        const task = getAgent()?.activeTask ?? null;
        for (;;) {
          const decision = /** @type {MemoryDecision} */ (await request("memories", { entries }));
          if (!decision || !validEntries(decision.entries)) throw new Error("Invalid memory decision");
          if (typeof decision.note === "string" && decision.note.trim()) return { entries: decision.entries, note: decision.note.trim() };
          try {
            const saved = await captureMemories(loreHome, decision.entries);
            emit({ type: "saved", task, memories: saved });
            emit({ type: "changed" });
            return { saved };
          } catch (error) {
            // The card was cleared on Keep; put it back as edited, with the reason, rather than losing the owner's words.
            emit({ type: "message", task, text: `Lore could not save that: ${/** @type {Error} */ (error).message}. Your edits are still here.` });
            entries = decision.entries;
          }
        }
      },
      proposeBlueprint: async (fields, evidence) => {
        const edited = /** @type {BlueprintFields} */ (await request("blueprint", { fields, evidence }));
        await lore(loreHome, ["blueprint", "apply", "-"], JSON.stringify(edited));
        emit({ type: "changed" });
        return edited;
      },
      proposePrice: async (amount, reason) => {
        // The agent proposes; this process saves only the number the owner
        // confirmed on the card, and hands that number back so the agent works
        // from what was actually set rather than what it suggested.
        const confirmed = await request("price", { amount, reason });
        if (typeof confirmed !== "number") return null;
        await setPrice(loreHome, confirmed);
        emit({ type: "changed" });
        return confirmed;
      },
      // Read at call time: the agent does not exist yet while these options are built.
      ...ownerGates({
        ask: (type, payload) => request(type, payload),
        signIn: (opened) => signInToCloudflare(loreHome, opened),
        notice: () => emit({ type: "live", task: getAgent()?.activeTask ?? null, text: "Finish signing in to Cloudflare in your browser, then come back here." }),
        openable
      }),
      openStore: async (store) => {
        const said = await openStore(loreHome, store, async (questions) => /** @type {Record<string, string>} */ (await request("question", { questions, source: "app" })), outgoing);
        // A store left half-changed is told to the owner directly, not only to the agent.
        const half = said.split("\n").find((line) => line.startsWith("Your store may be half-updated"));
        if (half) emit({ type: "message", task: getAgent()?.activeTask ?? null, text: half });
        emit({ type: "changed" });
        return said;
      },
      saveProfile: async (profile) => {
        const said = await saveProfile(loreHome, profile, async (questions) => /** @type {Record<string, string>} */ (await request("question", { questions, source: "app" })));
        emit({ type: "changed" });
        return said;
      },
      drafts: async () => (await candidates(loreHome)).length + (await extrasCandidates(loreHome)).length,
      checkedIn: async (job, verdict) => {
        if (!verdict) return void (await recordCheckIn(loreHome, COULD_NOT_LOOK));
        // The model only says whether it would reach out; posting is the app's call, and at most once a day.
        const posting = await checkIns.consider(verdict, job.items);
        await recordCheckIn(loreHome, posting ? `Asked about ${reading.plural(posting.questions.length, "thing")}` : NOTHING_TO_ASK, job.mark);
        if (!posting) return;
        // The questions open a thread of their own, as Lore's first message, never an older day's.
        const { asked, note } = checkin.opening(posting);
        getAgent()?.ask("evening", asked, note);
        emit({ type: "changed" });
        notify(checkin.announcement(posting), () => reveal({ type: "thread", task: "evening" }));
      },
      memoriesReady: async (read, report, wrote) => {
        // An agent's saves, judged: what looks worth selling joins the card they are already on.
        if (read.judge) {
          const run = reading.judged(read, report);
          if (!run.memories.length) return;
          try {
            await judgeMemories(loreHome, run.memories);
          } catch (error) {
            console.error("Lore could not record which memories look worth selling:", error);
          }
          await newMemories.extend(run);
          emit({ type: "changed" });
          emit({ type: "ready" });
          return;
        }
        await lore(loreHome, ["sync", "--source", "automation"]);
        const stored = JSON.parse(await lore(loreHome, ["search", "--source", "automation", "--limit", "0", "--json"]));
        const run = reading.landed(read, report, stored, join(loreHome, "memories"), wrote);
        const count = run.memories.length;
        // Collections the routine was asked for are only suggested: the owner reviews each in Lore's own picker.
        const offered = [];
        // Only memories Lore keeps now: an id the model made up never waits to land on one made later.
        const kept = report.collections?.length ? new Set(Object.keys(await readGists(loreHome)).map(Number)) : new Set();
        for (const asked of report.collections ?? []) {
          const picked = reading.suggested(asked, stored, join(loreHome, "memories")).filter((id) => kept.has(id));
          if (!picked.length) continue;
          await suggestions.add({ at: new Date().toISOString(), title: asked.title.trim(), memories: picked, from: read.label });
          offered.push(asked.title.trim());
        }
        if (offered.length) {
          emit({ type: "changed" });
          // Says what's waiting and asks for the look, so the owner knows it's worth a minute now.
          const what = offered.length === 1 ? "a collection" : `${offered.length} collections`;
          notify({ title: `Lore suggested ${what} you could sell`, body: `Review? ${offered.join(" · ")}` }, () => reveal({ type: "show", view: "inbox" }));
        }
        // What the reading judged is kept before anything announces the memories, so a sheet opened at once offers
        // Draft for sale only where it makes sense. Failing to keep it never costs the owner their card or banner.
        try {
          if (count) await judgeMemories(loreHome, run.memories);
        } catch (error) {
          console.error("Lore could not record which memories look worth selling:", error);
        }
        if (read.ask) await lore(loreHome, ["automation", "result", read.name, report.missing ? `${report.missing} isn't connected` : count ? reading.plural(count, "new memory") : offered.length ? `Suggested ${reading.plural(offered.length, "collection")}` : "Nothing new"]);
        emit({ type: "changed" });
        if (!count) return;
        // An agent's saves are on Today already, from when they came in: what reading them wrote joins that card, quietly.
        const fromAgent = read.by.kind === "agent";
        await (fromAgent ? newMemories.extend(run) : newMemories.add(run));
        emit({ type: "ready" });
        if (!fromAgent) notify(reading.announcement(run), () => reveal({ type: "show", view: "inbox" }));
        // Who wrote them is a nicety, kept last: failing to record it never costs the owner their memories' card or banner.
        try {
          await creditMemories(loreHome, run.memories.map((memory) => memory.id), read.by);
          emit({ type: "changed" });
        } catch (error) {
          console.error("Lore could not record who wrote these memories:", error);
        }
      },
      job: {
        // This process is the one that owes the row a close, so it claims the row
        // with its own pid. The long ceiling only bounds pid reuse; it is not a
        // turn timeout, and must never fire on a real capture.
        start: async (kind) => {
          const out = await lore(loreHome, ["job", "start", kind, "--pid", String(process.pid), "--timeout-minutes", "720"]);
          const id = JSON.parse(out)?.id;
          return typeof id === "number" ? id : null;
        },
        finish: async (id, status, summary, title, costUsd) => {
          const cost = costUsd === null ? [] : ["--cost-usd", String(costUsd)];
          await lore(loreHome, ["job", "finish", String(id), status, "--summary", summary, "--title", title, ...cost]);
        }
      },
      authPrompt: async ({ signal, ...prompt }) => String(await request("auth-prompt", { prompt }, signal)),
      authEvent: (event) => {
        if (event.type === "auth_url") {
          void shell.openExternal(event.url);
          emit({ type: "auth", message: event.instructions || "Finish signing in in your browser, then come back here." });
        } else {
          emit({ type: "auth", event });
        }
      }
    };
  }

  return { register: registerIpc, request, runNow, queueReadings, AFTER_RUN, showSaved, hasStore, hasInbox, watchSales, hidden, agentCallbacks, newMemories, suggestions, checkIns, firstRun, seenMemories };
}

module.exports = { Ipc, SALES_EVERY_MS, NOTHING_TO_ASK, COULD_NOT_LOOK };
