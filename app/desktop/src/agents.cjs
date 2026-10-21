// APP-207: the owner's personal agents save to the owner's own store. While Lore is open it asks the store what is
// waiting, and brings that in through the same read every connected app goes through.
const { existsSync } = require("node:fs");
const { join } = require("node:path");

/** APP-232: how soon Lore asks the store again. A check is one short read, so it comes every few seconds while an app
 * waits on the owner to allow it, every ten while Lore is on screen, and once a minute while it is out of sight. */
const PACE = { asking: 3_000, onScreen: 10_000, away: 60_000 };

class Watch {
  /** @type {Promise<void> | null} */
  #checking = null;
  /** Whether an app was asking to sign in at the last answer. */
  #asking = false;
  /** Whether a check was asked for while one was under way, so one more read is owed. */
  #again = false;

  /** @param {{ready: () => boolean | Promise<boolean>, waiting: () => Promise<AgentsWaiting>, read: (name: string) => Promise<SourceRead[]>, landed: (reads: SourceRead[]) => unknown, asked: (signIns: SignInRequest[]) => unknown}} store
   * `ready`: whether there is a store to ask; `landed`: what to do with what came in, once; `asked`: the apps asking
   * to sign in, every time the store answers (XC-068). */
  constructor(store) {
    this.store = store;
  }

  /** Bring in whatever is waiting. Two never overlap and nothing lands twice. A check asked for while one is under way
   * may have come after a save that read has already passed, so it waits for one more read behind it. */
  check() {
    if (this.#checking) {
      this.#again = true;
      return this.#checking;
    }
    this.#checking = this.#run();
    return this.#checking;
  }

  /** How long until the next check. @param {boolean} onScreen whether Lore's window is in sight */
  nextIn(onScreen) {
    if (this.#asking) return PACE.asking;
    return onScreen ? PACE.onScreen : PACE.away;
  }

  async #run() {
    try {
      do {
        this.#again = false;
        await this.#check();
      } while (this.#again);
    } finally {
      this.#checking = null;
    }
  }

  async #check() {
    if (!(await this.store.ready())) {
      this.#asking = false;
      return;
    }
    /** @type {SourceRead[]} */
    const reads = [];
    try {
      const { sources, sign_ins = [] } = await this.store.waiting();
      this.#asking = sign_ins.length > 0;
      this.store.asked(sign_ins);
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

module.exports = { Watch, PACE, AgentApps };
