const { updateElectronApp } = require("update-electron-app");

// Lore updates itself from this repo's GitHub releases through update.electronjs.org (APP-126).
// Squirrel swaps only the app bundle; memories, profile and sign-in live elsewhere and stay as they are.

const REPO = "dipakkrishnan/lore-mcp";
const DOWNLOAD = `https://github.com/${REPO}/releases/latest/download/Lore-macOS-arm64.zip`;

class Updates {
  /**
   * @param {Pick<typeof import("electron"), "app" | "autoUpdater" | "dialog" | "shell">} electron
   * @param {(update: AppUpdate) => void} emit
   * @param {typeof fetch} [get]
   */
  constructor({ app, autoUpdater, dialog, shell }, emit, get = fetch) {
    this.app = app;
    this.autoUpdater = autoUpdater;
    this.dialog = dialog;
    this.shell = shell;
    this.emit = emit;
    this.get = get;
    /** @type {AppUpdate} */
    this.update = { version: app.getVersion(), state: "current" };
    autoUpdater.on("checking-for-update", () => this.set({ state: "checking" }));
    autoUpdater.on("update-available", () => this.set({ state: "downloading" }));
    autoUpdater.on("update-not-available", () => this.set({ state: "current" }));
    autoUpdater.on("update-downloaded", () => this.set({ state: "ready" }));
    // Offline or the service is down: say so in Settings only, and try again on the next round.
    autoUpdater.on("error", () => this.update.state !== "ready" && this.set({ state: "offline" }));
  }

  /** On launch. A copy outside Applications (often run straight from Downloads, where macOS keeps it read-only) can't replace itself, so it asks to move first. */
  start() {
    if (!this.app.isPackaged) return;
    if (this.app.isInApplicationsFolder()) return void updateElectronApp({ repo: REPO, updateInterval: "4 hours", notifyUser: false });
    this.set({ state: "outside" });
    void this.move("Not now").catch(() => undefined);
    void this.check();
  }

  async check() {
    if (this.update.state !== "outside") return void (this.app.isPackaged && this.autoUpdater.checkForUpdates());
    const latest = `https://update.electronjs.org/${REPO}/${process.platform}-${process.arch}/${this.update.version}`;
    const answer = await this.get(latest, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    this.set({ state: "outside", newer: answer?.status === 200 });
  }

  async install() {
    if (this.update.state === "ready") return this.autoUpdater.quitAndInstall();
    if (this.update.state === "outside" && !(await this.move("Download it instead"))) await this.shell.openExternal(DOWNLOAD);
  }

  /** @param {string} other the second button's words @returns {Promise<boolean>} whether Lore moved (it relaunches from Applications) */
  async move(other) {
    const { response } = await this.dialog.showMessageBox({
      type: "question",
      message: "Move Lore to Applications so it can update itself",
      detail: "Your memories and sign-in stay just as they are.",
      buttons: ["Move to Applications", other],
      defaultId: 0,
      cancelId: 1
    });
    try {
      return response === 0 && this.app.moveToApplicationsFolder();
    } catch {
      return false;
    }
  }

  /** @param {Omit<AppUpdate, "version">} next */
  set(next) {
    this.update = { version: this.update.version, ...next };
    this.emit(this.update);
  }
}

module.exports = { Updates, DOWNLOAD };
