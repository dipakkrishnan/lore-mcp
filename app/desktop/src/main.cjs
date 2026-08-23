const { randomUUID } = require("node:crypto");
const { join } = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { provision, skillsDir } = require("./runtime.cjs");
const { lore, readState, searchMemories, candidates, decide, useRuntime } = require("./state.cjs");

if (process.env.LORE_DESKTOP_USER_DATA) app.setPath("userData", process.env.LORE_DESKTOP_USER_DATA);

const TASKS = new Set(["capture", "setup", "publish"]);
const LOGINS = new Set(["anthropic:oauth", "anthropic:api_key", "openai-codex:oauth", "openai:api_key"]);

/** @type {LoreAgentInstance} */
let agent;
/** @type {import("electron").BrowserWindow | undefined} */
let window;
/** @type {Map<string, {resolve(value: unknown): void, reject(error: Error): void}>} */
const pending = new Map();

/** @param {AgentEvent} event */
function emit(event) {
  window?.webContents.send("agent:event", event);
}

/** @param {AgentRequest["type"]} type @param {Record<string, unknown>} payload @param {AbortSignal} [signal] */
function request(type, payload, signal) {
  if (!window || window.isDestroyed()) return Promise.reject(new Error("Lore window is closed"));
  const id = randomUUID();
  emit(/** @type {AgentRequest} */ ({ type, id, ...payload }));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    signal?.addEventListener("abort", () => {
      if (!pending.delete(id)) return;
      emit({ type: "dismiss", id });
      reject(new Error("Cancelled"));
    }, { once: true });
  });
}

/** @param {string} loreHome */
function registerIpc(loreHome) {
  ipcMain.handle("snapshot:read", () => readState(loreHome));
  ipcMain.handle("agent:status", () => agent.status());
  ipcMain.handle("agent:prompt", (_event, input) => {
    if (!input || typeof input.text !== "string" || input.text.length > 100_000 || !TASKS.has(input.task)) {
      throw new Error("Invalid prompt");
    }
    return agent.prompt(input.text, input.task);
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
    return agent.login(input.providerId, input.type, input.secret);
  });
  ipcMain.handle("auth:logout", (_event, providerId) => {
    if (typeof providerId !== "string") throw new Error("Invalid provider");
    return agent.logout(providerId);
  });
  ipcMain.handle("search:query", (_event, query) => {
    if (typeof query !== "string" || query.length > 200) throw new Error("Invalid search");
    return searchMemories(loreHome, query);
  });
  ipcMain.handle("publication:candidates", () => candidates(loreHome));
  ipcMain.handle("publication:decide", (_event, input) => {
    if (!input || typeof input.approve !== "boolean" || !input.candidate || typeof input.candidate !== "object") {
      throw new Error("Invalid decision");
    }
    return decide(loreHome, input.candidate, input.approve);
  });
  ipcMain.handle("publication:revoke", async (_event, id) => {
    if (!Number.isInteger(id) || id < 1) throw new Error("Invalid publication");
    await lore(loreHome, ["publication", "revoke", String(id)], "");
  });
  ipcMain.handle("store:push", async () => {
    await lore(loreHome, ["push"], "");
  });
  ipcMain.handle("files:pick", async () => {
    if (!window) return [];
    const { filePaths } = await dialog.showOpenDialog(window, { properties: ["openFile", "multiSelections"] });
    return filePaths;
  });
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
  createWindow();
  await new Promise((loaded) => window?.webContents.once("did-finish-load", () => loaded(undefined)));
  try {
    await start();
    emit({ type: "progress", done: true });
  } catch (error) {
    console.error(error);
    emit({ type: "progress", error: "Lore could not finish setting up. Check your internet connection, then reopen Lore." });
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

async function start() {
  const runtime = await provision(emit);
  if (runtime) useRuntime(runtime.bin);
  const [{ LoreAgent }, { CredentialStore }] = await Promise.all([
    import("./agent.mjs"),
    import("./credentials.mjs")
  ]);
  const loreHome = process.env.LORE_HOME || join(app.getPath("home"), ".lore");
  const credentials = new CredentialStore(join(app.getPath("userData"), "credentials.bin"), safeStorage);
  agent = await LoreAgent.create({
    loreHome,
    skillsDir,
    binDir: runtime?.binDir,
    credentials,
    emit,
    approveBash: async (command, action) => (await request("bash-approval", { command, action })) === true,
    askUser: async (questions) =>
      /** @type {Record<string, string>} */ (await request("question", { questions })),
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
  registerIpc(loreHome);
}

app.on("before-quit", () => {
  agent?.dispose();
  for (const waiter of pending.values()) waiter.reject(new Error("Lore closed"));
  pending.clear();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
