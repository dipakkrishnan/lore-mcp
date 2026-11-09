// The Electron wiring: the window, the app's lifecycle, the single-instance lock, and the bundle of real Electron pieces
// the main process's logic takes. That logic lives in ipc.cjs, behind a seam node --test reaches (APP-267).
const { join } = require("node:path");
const { app, autoUpdater, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, powerMonitor, safeStorage, shell, systemPreferences } = require("electron");
const { provision, skillsDir } = require("./runtime.cjs");
const sales = require("./sales.cjs");
const { Updates } = require("./updates.cjs");
const reading = require("./reading.cjs");
const { BidWatch, BIDS_URL, nextLook, announcements: bidNews } = require("./bids.cjs");
const { Schedule } = require("./routines.cjs");
const { Appearance } = require("./appearance.cjs");
const { Watch } = require("./agents.cjs");
const { Ipc } = require("./ipc.cjs");
const { listRoutines, matchBids, agentsWaiting, readSource, useRuntime, Outgoing, forgetKey } = require("./state.cjs");
const { OwnerRequests } = require("./owner.cjs");

if (process.env.LORE_DESKTOP_USER_DATA) app.setPath("userData", process.env.LORE_DESKTOP_USER_DATA);
// Two copies sharing one credentials file each refresh the sign-in, and the provider refuses the second.
if (!app.requestSingleInstanceLock()) app.exit();

// Every `lore` this app runs reports usage under the app's version, not the CLI's.
process.env.LORE_APP_VERSION = app.getVersion();

/** @type {LoreAgentInstance | undefined} */
let agent;
/** @type {import("electron").BrowserWindow | undefined} */
let window;
/** The cards waiting on the owner's answer (APP-062). */
const requests = new OwnerRequests({ open: () => Boolean(window && !window.isDestroyed()), emit: (event) => emit(event) });
/** What Lore read from connected apps, kept until the owner clears it, with the dock's red number. */
const badge = new reading.Badge((count) => app.setBadgeCount(count));
/** Light, dark, or the Mac's own (APP-225). */
const appearance = new Appearance(join(app.getPath("userData"), "appearance.json"), nativeTheme);
/** The owner's Lore. */
const LORE_HOME = process.env.LORE_HOME || join(app.getPath("home"), ".lore");
/** Open bids the owner's memories answer, matched here; the board's address can point elsewhere for a test (APP-274). */
const bids = new BidWatch({
  file: join(app.getPath("userData"), "bid-matches.json"),
  match: (board) => matchBids(LORE_HOME, board),
  badge: badge.part("bids"),
  url: process.env.LORE_BIDS_URL || BIDS_URL
});
/** @param {AgentEvent} event */
function emit(event) {
  window?.webContents.send("agent:event", event);
}
const updates = new Updates({ app, autoUpdater, dialog, shell }, (update) => emit({ type: "update", update }));

/** The main process's logic, over the real Electron pieces. The window and the agent are read at call time: neither
 * exists yet here, and either can go away. */
const { register, request, runNow, queueReadings, hasInbox, watchSales, hidden, agentCallbacks, newMemories, checkIns } = Ipc({
  ipcMain,
  shell,
  clipboard,
  dialog,
  systemPreferences,
  BrowserWindow,
  paths: { userData: app.getPath("userData"), temp: app.getPath("temp"), home: app.getPath("home") },
  notify: (words, onClick) => sales.notify(words, onClick),
  emit,
  reveal,
  getWindow: () => window,
  createWindow,
  getAgent: () => agent,
  requests,
  badge,
  bids,
  updates,
  appearance,
  boot,
  onFocus: (listener) => void app.on("browser-window-focus", listener)
});

/** Bring the window forward, then show what the notification was about. A window opened for it, or one still loading,
 * hears that once its page has loaded, so nothing is said before anyone listens. @param {AgentEvent} event */
function reveal(event) {
  if (window && !window.webContents.isLoading()) emit(event);
  else (window ?? createWindow()).webContents.once("did-finish-load", () => emit(event));
  window?.show();
  window?.focus();
}

function createWindow() {
  window = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 760,
    minHeight: 620,
    // APP-281: one canvas. The page paints the sidebar too; the window's own colour only shows before the page loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1011" : "#fcfcfd",
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
    requests.rejectAll("Lore window closed");
  });
  void window.loadFile(join(__dirname, "index.html"));
  return window;
}

app.whenReady().then(async () => {
  // Run from source, Electron would show its own icon in the Dock; the packaged app gets Lore's from forge.
  if (!app.isPackaged) app.dock?.setIcon(join(__dirname, "..", "packaging", "icon.png"));
  const loreHome = LORE_HOME;
  // The owner's rhythm, kept by Lore while it is open; an hour missed while it was closed runs once, after setup.
  /** The sign-ins the owner has been told of. @type {Set<string>} */
  const told = new Set();
  const schedule = new Schedule(() => listRoutines(loreHome), (routine) => runNow(loreHome, routine));
  const watch = new Watch({
    ready: () => hasInbox(loreHome),
    waiting: () => agentsWaiting(loreHome),
    read: (name) => readSource(loreHome, name),
    landed: async (reads) => {
      await queueReadings(loreHome, reads);
      emit({ type: "agents", reads });
    },
    asked: (signIns) => {
      emit({ type: "sign-ins", signIns });
      // XC-068: the app's page waits on the owner, so one away from Lore hears of each ask once.
      for (const asking of signIns.filter((each) => !told.has(each.id))) {
        told.add(asking.id);
        if (!window?.isFocused()) sales.notify({ title: `${asking.name} wants to save to your Lore`, body: "Open Lore to allow it." }, () => reveal({ type: "show", view: "connectors" }));
      }
    }
  });
  const outgoing = new Outgoing(loreHome, async (heading, changes) => (await request("changes", { heading, changes })) === true);
  register(loreHome, schedule, watch, outgoing);
  await appearance.apply();
  createWindow();
  await new Promise((loaded) => window?.webContents.once("did-finish-load", () => loaded(undefined)));
  updates.start(window);
  await boot(loreHome, outgoing);
  watchSales(loreHome);
  watchBids();
  watchAgents(watch);
  void newMemories.show();
  void checkIns.show();
  void bids.show();
  void schedule.check();
  powerMonitor.on("resume", () => void schedule.check());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/** A Mac notification for each open bid the owner's memories answer. The board is read now and then about every
 * quarter hour, never on the owner's comings and goings, so its server can't tell when they use the app. */
function watchBids() {
  const look = async () => {
    try {
      const fresh = await bids.check();
      // One bid opens its own page; a lot of them, the Inbox that lists them (APP-283).
      const [only] = fresh.length === 1 ? fresh : [];
      for (const words of bidNews(fresh)) sales.notify(words, () => reveal({ type: "show", view: "inbox", ...(only ? { bid: only.bid.id } : {}) }));
      // Remembered only once the banners are up: one that failed is announced on the next look.
      await bids.announced(fresh.map((match) => match.bid.id));
      if (fresh.length) emit({ type: "changed" });
    } catch (error) {
      // Offline, or the board is down: the next look tries again.
      console.error("Lore could not read the bids board:", error);
    }
    setTimeout(() => void look(), nextLook());
  };
  void look();
}

/** What the owner's agents saved comes in while Lore is open: now, on coming back to the app, and at the watch's own
 * pace after each check, sooner while Lore is on screen or an app waits to sign in (APP-232).
 * @param {InstanceType<typeof Watch>} watch */
function watchAgents(watch) {
  const onScreen = () => Boolean(window && !window.isDestroyed() && window.isVisible() && !window.isMinimized());
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  let turn = 0;
  // Coming back to Lore checks now and starts the pace over, so a long wait set while out of sight doesn't hold.
  const loop = async () => {
    const mine = ++turn;
    clearTimeout(timer);
    await watch.check().catch(() => undefined);
    if (mine === turn) timer = setTimeout(() => void loop(), watch.nextIn(onScreen()));
  };
  app.on("browser-window-focus", () => void loop());
  void loop();
}

/** @param {string} loreHome @param {InstanceType<typeof Outgoing>} outgoing */
async function boot(loreHome, outgoing) {
  try {
    await start(loreHome, outgoing);
    emit({ type: "progress", done: true });
  } catch (error) {
    console.error(error);
    emit({ type: "progress", error: "Lore could not finish setting up on this Mac." });
  }
}

/** @param {string} loreHome @param {InstanceType<typeof Outgoing>} outgoing */
async function start(loreHome, outgoing) {
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
    hidden: hidden(),
    credentials,
    emit,
    ...agentCallbacks(loreHome, outgoing, validEntries)
  });
}

app.on("will-quit", () => forgetKey());

app.on("before-quit", () => {
  agent?.dispose();
  requests.rejectAll("Lore closed");
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
