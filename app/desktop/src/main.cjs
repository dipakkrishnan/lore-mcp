const { randomUUID } = require("node:crypto");
const { existsSync } = require("node:fs");
const { appendFile } = require("node:fs/promises");
const { join } = require("node:path");
const { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, powerMonitor, safeStorage, shell, systemPreferences } = require("electron");
const { provision, skillsDir, whisper } = require("./runtime.cjs");
const { transcribe } = require("./dictation.cjs");
const sales = require("./sales.cjs");
const { Updates } = require("./updates.cjs");
const reading = require("./reading.cjs");
const checkin = require("./checkin.cjs");
const { Schedule } = require("./routines.cjs");
const { Watch, WATCH_EVERY_MS } = require("./agents.cjs");
const { lore, listRoutines, runRoutine, changeRoutine, addRoutine, editRoutine, switchSource, loreStream, openable, readState, readSales, readViews, searchMemories, readMemory, renameMemory, editMemory, captureMemories, previewPage, setPrice, setFreeCopies, candidates, decide, extrasCandidates, decideExtras, approveExtras, reportFeedback, listStore, cardStatus, connectCards, switchCards, listingStatus, sourceCatalog, sourceChoices, connectSource, signIn, readSource, removeSource, listAgents, connectAgent, agentKey, disconnectAgent, agentsWaiting, useRuntime } = require("./state.cjs");

if (process.env.LORE_DESKTOP_USER_DATA) app.setPath("userData", process.env.LORE_DESKTOP_USER_DATA);
// Two copies sharing one credentials file each refresh the sign-in, and the provider refuses the second.
if (!app.requestSingleInstanceLock()) app.exit();

// Every `lore` this app runs reports usage under the app's version, not the CLI's.
process.env.LORE_APP_VERSION = app.getVersion();
const TASKS = new Set(["capture", "setup", "publish", "deploy", "evening"]);
/** What the renderer may report: that the usage notice was on screen, and that the app opened. */
const USAGE = new Set(["noticed", "app.opened"]);
const LOGINS = new Set(["anthropic:oauth", "anthropic:api_key", "openai-codex:oauth", "openai:api_key"]);

/** @type {LoreAgentInstance | undefined} */
let agent;
/** The agent, once setup has finished. */
function ready() {
  if (!agent) throw new Error("Lore is still setting up on this Mac");
  return agent;
}
/** @type {import("electron").BrowserWindow | undefined} */
let window;
/** @type {Map<string, {resolve(value: unknown): void, reject(error: Error): void}>} */
const pending = new Map();
/** The connect or sign-in in flight, if any; closing its sheet stops it. @type {AbortController | undefined} */
let connecting;
/** What Lore read from connected apps, kept until the owner clears it, with the dock's red number. */
const badge = new reading.Badge((count) => app.setBadgeCount(count));
const newMemories = new reading.Ready(join(app.getPath("userData"), "memories-ready.json"), badge.part("memories"));
/** The evening check-in waiting for the owner, if Lore found something worth asking (AUT-008). */
const checkIns = new checkin.CheckIns(join(app.getPath("userData"), "check-in.json"), badge.part("checkin"));
/** @param {AgentEvent} event */
function emit(event) {
  window?.webContents.send("agent:event", event);
}
const updates = new Updates({ app, autoUpdater, dialog, shell }, (update) => emit({ type: "update", update }));

/** @param {AgentRequest["type"]} type @param {Record<string, unknown>} payload @param {AbortSignal} [signal] */
function request(type, payload, signal) {
  if (!window || window.isDestroyed()) return Promise.reject(new Error("Lore window is closed"));
  const id = randomUUID();
  emit(/** @type {AgentRequest} */ ({ type, id, task: agent?.activeTask, ...payload }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    signal?.addEventListener("abort", () => {
      if (!pending.delete(id)) return;
      emit({ type: "dismiss", id });
      reject(new Error("Cancelled"));
    }, { once: true });
  });
}

/** @param {string} loreHome @param {InstanceType<typeof Schedule>} schedule @param {InstanceType<typeof Watch>} watch */
function registerIpc(loreHome, schedule, watch) {
  ipcMain.handle("snapshot:read", () => readState(loreHome));
  ipcMain.handle("dictation:permission", () => systemPreferences.askForMediaAccess("microphone"));
  ipcMain.handle("update:status", () => updates.update);
  ipcMain.handle("update:check", () => updates.check());
  ipcMain.handle("update:install", () => updates.install());
  ipcMain.handle("dictation:transcribe", (_event, /** @type {ArrayBuffer} */ wav) => transcribe({ ...whisper, dir: app.getPath("temp") }, Buffer.from(wav)));
  ipcMain.handle("setup:retry", () => (agent ? undefined : boot(loreHome)));
  ipcMain.handle("agent:status", () => agent?.status() ?? { credentials: [] });
  ipcMain.handle("agent:prompt", (_event, input) => {
    if (!input || typeof input.text !== "string" || input.text.length > 100_000 || !TASKS.has(input.task) || (input.from !== undefined && !TASKS.has(input.from)) || (input.memory !== undefined && !Number.isInteger(input.memory)) || (input.source !== undefined && typeof input.source !== "string")) {
      throw new Error("Invalid prompt");
    }
    // The owner's first word to a check-in answers it, once the turn went through; one that failed leaves it waiting.
    const turn = ready().prompt(input.text, input.task, input.from, input.memory, input.source);
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
  ipcMain.handle("agent:respond", (_event, response) => {
    if (!response || typeof response.id !== "string" || !pending.has(response.id)) {
      throw new Error("Unknown agent request");
    }
    pending.get(response.id)?.resolve(response.value);
    pending.delete(response.id);
  });
  ipcMain.handle("auth:login", (_event, input) => {
    if (!input || !LOGINS.has(`${input.providerId}:${input.type}`)) throw new Error("Unsupported sign-in");
    if (input.secret !== undefined && typeof input.secret !== "string") throw new Error("Invalid key");
    return ready().login(input.providerId, input.type, input.secret).then((auth) => {
      void lore(loreHome, ["telemetry", "record", "signin.completed"]).catch(() => undefined);
      return auth;
    });
  });
  ipcMain.handle("usage:record", (_event, name) => {
    if (!USAGE.has(name)) throw new Error("Unknown usage event");
    return lore(loreHome, name === "noticed" ? ["telemetry", "noticed"] : ["telemetry", "record", name]).then(() => undefined);
  });
  ipcMain.handle("telemetry:set", (_event, on) => lore(loreHome, ["telemetry", on === true ? "on" : "off"]).then(() => undefined));
  ipcMain.handle("telemetry:log", async () => {
    const log = join(loreHome, "usage.log");
    await appendFile(log, "");
    return shell.openPath(log);
  });
  ipcMain.handle("auth:logout", (_event, providerId) => {
    if (typeof providerId !== "string") throw new Error("Invalid provider");
    return ready().logout(providerId);
  });
  ipcMain.handle("search:query", (_event, query) => {
    if (typeof query !== "string" || query.length > 200) throw new Error("Invalid search");
    return searchMemories(loreHome, query);
  });
  ipcMain.handle("memory:read", (_event, id) => readMemory(loreHome, id));
  ipcMain.handle("memory:rename", (_event, id, title) => {
    if (typeof title !== "string") throw new Error("Invalid title");
    return renameMemory(loreHome, id, title);
  });
  ipcMain.handle("memory:edit", (_event, id, content) => {
    if (typeof content !== "string") throw new Error("Invalid content");
    return editMemory(loreHome, id, content);
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
      parent: window ?? undefined,
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
  ipcMain.handle("publication:decide-extras", (_event, input) => {
    if (!input || typeof input.approve !== "boolean" || !input.original || typeof input.original !== "object" || !input.extras || typeof input.extras !== "object") {
      throw new Error("Invalid decision");
    }
    return decideExtras(loreHome, input.original, input.extras, input.approve);
  });
  ipcMain.handle("publication:approve-extras", async (_event, decisions) => {
    if (!Array.isArray(decisions) || !decisions.length || !decisions.every((d) => d && typeof d.original === "object" && d.original && typeof d.extras === "object" && d.extras)) {
      throw new Error("Invalid decisions");
    }
    await approveExtras(loreHome, decisions);
    if (!window?.isFocused()) {
      sales.notify({ title: "Your store is updated", body: `${decisions.length} pieces have their new pages.` }, () => {
        if (!window) createWindow();
        window?.show();
        window?.focus();
      });
    }
  });
  ipcMain.handle("publication:revoke", async (_event, id) => {
    if (!Number.isInteger(id) || id < 1) throw new Error("Invalid publication");
    await lore(loreHome, ["publication", "revoke", String(id)], "");
  });
  ipcMain.handle("store:push", async () => {
    await lore(loreHome, ["push"], "");
  });
  ipcMain.handle("store:sales", () => readSales(loreHome));
  ipcMain.handle("store:views", () => readViews(loreHome));
  ipcMain.handle("pricing:set", (_event, amount) => setPrice(loreHome, amount));
  ipcMain.handle("pricing:free-copies", (_event, count) => setFreeCopies(loreHome, count));
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
    // Stripe's hosted form doesn't run inside the app window.
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
  ipcMain.handle("ready:seen", () => newMemories.seen());
  ipcMain.handle("ready:clear", () => newMemories.clear());
  ipcMain.handle("checkin:waiting", () => checkIns.waiting());
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
    await agent?.settled();
    const done = /** @type {Routine} */ ((await listRoutines(loreHome)).find((each) => each.id === id));
    // The owner asked, so they hear it finished: here if they are away, unless the run already told them what it found.
    if (!window?.isFocused() && (await told()) === before) {
      sales.notify({ title: `“${done.name}” is done`, body: done.result || "Nothing new" }, () => reveal({ type: "show", view: "automations" }));
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
  ipcMain.handle("agents:list", () => listAgents(loreHome));
  ipcMain.handle("agents:connect", (_event, input) => connectAgent(loreHome, input));
  ipcMain.handle("agents:key", (_event, source) => agentKey(loreHome, source));
  ipcMain.handle("agents:disconnect", (_event, source, keep) => disconnectAgent(loreHome, source, keep === true));
  ipcMain.handle("agents:check", () => watch.check());
  ipcMain.handle("clipboard:write", (_event, text) => {
    if (typeof text !== "string" || text.length > 100_000) throw new Error("Nothing to copy");
    clipboard.writeText(text);
  });
  // The Files and Folders pane, where the owner grants the read a folder needs.
  ipcMain.handle("settings:privacy", () => shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders"));
  ipcMain.handle("folders:pick", async () => {
    if (!window) return null;
    const { filePaths } = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    return filePaths[0] ?? null;
  });
  ipcMain.handle("files:pick", async () => {
    if (!window) return [];
    const { filePaths } = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"] });
    return filePaths;
  });
}

/** Whatever a connect, a read or a routine brought in from an app, Lore reads through in the background.
 * @template {{name: string, connector?: string | null, added?: number}} T @param {string} loreHome @param {T} read */
function readThrough(loreHome, read) {
  void queueReadings(loreHome, [read]);
  return read;
}

/** Put each app's new items in line to be read. @param {string} loreHome @param {Array<{name: string, connector?: string | null, added?: number}>} reads */
async function queueReadings(loreHome, reads) {
  if (!reads.some((read) => read.added)) return;
  const apps = await sourceCatalog(loreHome).catch(() => []);
  for (const read of reads) {
    const next = reading.worthReading(read, apps);
    if (next) agent?.synthesize(next);
  }
}

/** What Lore last told the owner about, so a run can tell whether it already did. */
async function told() {
  return JSON.stringify([(await newMemories.runs())[0], (await checkIns.latest())?.at]);
}

/** Bring the window forward, then show what the notification was about. @param {AgentEvent} event */
function reveal(event) {
  if (!window) createWindow();
  window?.show();
  window?.focus();
  emit(event);
}

/** What the app does with each kind of routine's run, by the `kind` the CLI names. A new kind is one entry here.
 * @type {Record<Routine["kind"], (loreHome: string, ran: RoutineRun) => void | Promise<void>>} */
const AFTER_RUN = {
  read: (loreHome, ran) => queueReadings(loreHome, ran.reads ?? []),
  // The check-in retires one from an earlier day the owner never answered, and asks at most once a day. It looks over
  // what came in only if anything did; a day with nothing costs no model at all. A missed one the CLI already recorded.
  checkin: async (loreHome, { items = [], mark, missed }) => {
    if (missed) return;
    await checkIns.retire().then(closeCheckIn);
    if (await checkIns.askedToday()) return;
    if (!items.length) await recordCheckIn(loreHome, NOTHING_TO_ASK, mark);
    else if (agent) agent.checkIn({ items, mark });
    else await recordCheckIn(loreHome, COULD_NOT_LOOK);
  },
  // One of the owner's own: their sentence, read through quietly like a connected app, into private memories.
  ask: (_loreHome, { routine, ask = "" }) => agent?.synthesize(reading.asking(routine, ask))
};

const NOTHING_TO_ASK = "Nothing new to ask about";
const COULD_NOT_LOOK = "Couldn't look over today. Lore will try again next time";

/** What the check-in came to; with `mark`, the newest item its model judged, so the next one starts after it.
 * @param {string} loreHome @param {string} result @param {number} [mark] */
function recordCheckIn(loreHome, result, mark) {
  return lore(loreHome, ["automation", "result", "checkin", result, ...(mark === undefined ? [] : ["--mark", String(mark)])]);
}

/** A check-in that went unanswered takes its thread off Today with it. @param {boolean} expired */
function closeCheckIn(expired) {
  if (!expired) return;
  try {
    agent?.restart("evening");
  } catch {}
}

/** Run one routine through the CLI, then do what its kind asks with what it brought. @param {string} loreHome @param {Routine} routine */
async function runNow(loreHome, routine) {
  const ran = await runRoutine(loreHome, routine.id);
  await AFTER_RUN[ran.routine.kind](loreHome, ran);
  emit({ type: "changed" });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    backgroundColor: "#f7f3ea",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || url.startsWith("http://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.on("closed", () => {
    window = undefined;
    for (const waiter of pending.values()) waiter.reject(new Error("Lore window closed"));
    pending.clear();
  });
  void window.loadFile(join(__dirname, "index.html"));
}

app.whenReady().then(async () => {
  const loreHome = process.env.LORE_HOME || join(app.getPath("home"), ".lore");
  // The owner's rhythm, kept by Lore while it is open; an hour missed while it was closed runs once, after setup.
  const schedule = new Schedule(() => listRoutines(loreHome), (routine) => runNow(loreHome, routine));
  const watch = new Watch({
    ready: () => hasStore(loreHome),
    waiting: () => agentsWaiting(loreHome),
    read: (name) => readSource(loreHome, name),
    landed: async (reads) => {
      await queueReadings(loreHome, reads);
      emit({ type: "agents", reads });
    }
  });
  registerIpc(loreHome, schedule, watch);
  createWindow();
  await new Promise((loaded) => window?.webContents.once("did-finish-load", () => loaded(undefined)));
  updates.start();
  await boot(loreHome);
  watchSales(loreHome);
  watchAgents(watch);
  void newMemories.show();
  void checkIns.show();
  void schedule.check();
  powerMonitor.on("resume", () => void schedule.check());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/** Reading the ledger asks Cloudflare, so once a minute is plenty; coming back to the app checks at once. */
const SALES_EVERY_MS = 60_000;

/** Only a deployed store has a ledger or an inbox; until one exists Lore never asks. @param {string} loreHome */
function hasStore(loreHome) {
  return existsSync(join(loreHome, "node", "node_modules", ".bin", "wrangler"));
}

/** What the owner's agents saved comes in while Lore is open: once a minute, on coming back to the app, and now.
 * @param {InstanceType<typeof Watch>} watch */
function watchAgents(watch) {
  setInterval(() => void watch.check(), WATCH_EVERY_MS);
  app.on("browser-window-focus", () => void watch.check());
  void watch.check();
}

/** A Mac notification for every new sale while Lore is open. The last one announced is kept on disk,
 * so a relaunch never repeats one and a first look at an old store doesn't replay its history.
 * @param {string} loreHome */
function watchSales(loreHome) {
  const seenFile = join(app.getPath("userData"), "sales-seen.json");
  let checking = false;
  const check = async () => {
    // Only a deployed store has a ledger; skip the CLI entirely until one exists.
    if (checking || !hasStore(loreHome)) return;
    checking = true;
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
        sales.notify(words, () => {
          if (!window) createWindow();
          window?.show();
          window?.focus();
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
  setInterval(() => void check(), SALES_EVERY_MS);
  app.on("browser-window-focus", () => void check());
  void check();
}

/** @param {string} loreHome */
async function boot(loreHome) {
  try {
    await start(loreHome);
    emit({ type: "progress", done: true });
  } catch (error) {
    console.error(error);
    emit({ type: "progress", error: "Lore could not finish setting up on this Mac." });
  }
}

/** @param {string} loreHome */
async function start(loreHome) {
  // From source, LORE_DESKTOP_BIN_DIR stands in for the bundled CLI, so the agent runs the checkout's, not whatever `lore` a shell profile finds first.
  const dev = !app.isPackaged && process.env.LORE_DESKTOP_BIN_DIR;
  const runtime = dev ? { bin: join(dev, "lore"), binDir: dev } : await provision(emit);
  if (runtime) useRuntime(runtime.bin);
  const [{ LoreAgent, validEntries }, { CredentialStore }] = await Promise.all([
    import("./agent.mjs"),
    import("./credentials.mjs")
  ]);
  const credentials = new CredentialStore(join(app.getPath("userData"), "credentials.bin"), safeStorage);
  agent = await LoreAgent.create({
    loreHome,
    skillsDir,
    binDir: runtime?.binDir,
    credentials,
    emit,
    askUser: async (questions) =>
      /** @type {Record<string, string>} */ (await request("question", { questions })),
    proposeMemories: async (entries) => {
      const task = agent?.activeTask ?? null;
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
    cloudflareLogin: async () => {
      if (!(await request("cloudflare", {}))) return "The owner chose not to sign in to Cloudflare right now.";
      let last = "";
      try {
        await loreStream(loreHome, ["node", "login"], (line) => {
          last = line;
          const url = line.match(/https:\/\/dash\.cloudflare\.com\/\S+/)?.[0];
          if (!url) return;
          void shell.openExternal(url);
          emit({ type: "live", task: agent?.activeTask ?? null, text: "Finish signing in to Cloudflare in your browser, then come back here." });
        });
      } catch (error) {
        throw new Error(last.replace(/^lore: /, "") || /** @type {Error} */ (error).message);
      }
      return last;
    },
    openUrl: async (page) => {
      if (!openable(page.url)) return "Lore does not open that address; only Coinbase, Cloudflare and Basescan pages.";
      const answer = await request("open", page);
      if (answer === "done") return "The owner says they finished there; verify from state before going on.";
      return answer === "stuck" ? "The owner got stuck on that page; ask what happened." : "The owner chose not to open it right now.";
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
      agent?.ask("evening", asked, note);
      emit({ type: "changed" });
      sales.notify(checkin.announcement(posting), () => reveal({ type: "thread", task: "evening" }));
    },
    memoriesReady: async (read, report) => {
      await lore(loreHome, ["sync", "--source", "automation"]);
      const stored = JSON.parse(await lore(loreHome, ["search", "--source", "automation", "--limit", "0", "--json"]));
      const run = reading.landed(read, report, stored, join(loreHome, "memories"));
      const wrote = run.memories.length;
      if (read.ask) await lore(loreHome, ["automation", "result", read.name, wrote ? reading.plural(wrote, "new memory") : "Nothing new"]);
      emit({ type: "changed" });
      if (!wrote) return;
      await newMemories.add(run);
      emit({ type: "ready" });
      sales.notify(reading.announcement(run), () => {
        if (!window) createWindow();
        window?.show();
        window?.focus();
        emit({ type: "show", view: "today" });
      });
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
  });
}

app.on("before-quit", () => {
  agent?.dispose();
  for (const waiter of pending.values()) waiter.reject(new Error("Lore closed"));
  pending.clear();
});

app.on("second-instance", () => {
  if (!window) createWindow();
  if (window?.isMinimized()) window.restore();
  window?.show();
  window?.focus();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
