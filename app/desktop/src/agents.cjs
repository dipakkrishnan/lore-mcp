// APP-207: the owner's personal agents save to the owner's own store. While Lore is open it asks the store what is
// waiting, and brings that in through the same read every connected app goes through.
const { existsSync } = require("node:fs");
const { join } = require("node:path");

/** Asking the store goes through Cloudflare, so once a minute is plenty; coming back to the app asks at once. */
const WATCH_EVERY_MS = 60_000;

class Watch {
  /** @type {Promise<void> | null} */
  #checking = null;

  /** @param {{ready: () => boolean, waiting: () => Promise<{waiting: number, sources: string[]}>, read: (name: string) => Promise<SourceRead[]>, landed: (reads: SourceRead[]) => unknown}} store
   * `ready`: whether there is a store to ask; `landed`: what to do with what came in, once. */
  constructor(store) {
    this.store = store;
  }

  /** Bring in whatever is waiting. A check under way is this one, so two never overlap and nothing lands twice. */
  check() {
    this.#checking ??= this.#check().finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  async #check() {
    if (!this.store.ready()) return;
    /** @type {SourceRead[]} */
    const reads = [];
    try {
      const { sources } = await this.store.waiting();
      for (const name of sources) {
        // One agent's read failing leaves the others' saves to land; its own wait for the next check.
        reads.push(...(await this.store.read(name).catch(() => [])));
      }
    } catch {
      // Offline or signed out of Cloudflare: the next check tries again.
    }
    if (reads.length) await this.store.landed(reads);
  }
}

/** APP-216: the agent apps Lore looks for, by agent id, as each is named in Applications. Muse has no Mac app. */
const AGENT_APPS = { grok: "Grok Bot.app", chatgpt: "ChatGPT.app", claude: "Claude.app" };

/** Which of the owner's agent apps are on this Mac, and opening one. Only the apps above and only by id: nothing else
 * on disk is looked at, and the renderer never names a path. */
class AgentApps {
  /** @param {string[]} roots where apps are installed @param {(path: string) => Promise<string>} launch resolves to an error, or "" */
  constructor(roots, launch) {
    this.roots = roots;
    this.launch = launch;
  }

  /** @param {unknown} id */
  #path(id) {
    if (typeof id !== "string" || !Object.hasOwn(AGENT_APPS, id)) return undefined;
    const name = AGENT_APPS[/** @type {keyof typeof AGENT_APPS} */ (id)];
    return this.roots.map((root) => join(root, name)).find((path) => existsSync(path));
  }

  /** The ids of the agent apps installed. @returns {Promise<AgentApp[]>} */
  async installed() {
    return /** @type {AgentApp[]} */ (Object.keys(AGENT_APPS).filter((id) => this.#path(id)));
  }

  /** @param {unknown} id */
  async open(id) {
    const path = this.#path(id);
    if (!path) throw new Error("Lore can't open that app");
    const failed = await this.launch(path);
    if (failed) throw new Error(failed);
  }
}

module.exports = { Watch, WATCH_EVERY_MS, AgentApps };
