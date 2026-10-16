// APP-207: the owner's personal agents save to the owner's own store. While Lore is open it asks the store what is
// waiting, and brings that in through the same read every connected app goes through.

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

module.exports = { Watch, WATCH_EVERY_MS };
