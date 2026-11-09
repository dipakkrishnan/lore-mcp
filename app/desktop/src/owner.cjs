const { randomUUID } = require("node:crypto");

// APP-062: what the agent hears back from the owner, out of main.cjs so node --test reaches it without Electron.
// main.cjs builds these from the window and the agent; the wording and branching the owner meets live here.

/** The owner's answers the agent is waiting on, each keyed by the id of the card that asks. */
class OwnerRequests {
  /** @param {{open: () => boolean, emit: (event: AgentEvent) => void}} window Whether the window can still show a card, and how to send it one. */
  constructor({ open, emit }) {
    this.open = open;
    this.emit = emit;
    /** @type {Map<string, {resolve(value: unknown): void, reject(error: Error): void}>} */
    this.pending = new Map();
  }

  /** Show the owner a card and wait for their answer; `signal` takes the card back unanswered.
   * @param {AgentRequest["type"]} type @param {Record<string, unknown>} payload @param {AgentTask | null | undefined} task @param {AbortSignal} [signal] */
  ask(type, payload, task, signal) {
    if (!this.open()) return Promise.reject(new Error("Lore window is closed"));
    const id = randomUUID();
    this.emit(/** @type {AgentRequest} */ ({ type, id, task, ...payload }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      signal?.addEventListener("abort", () => {
        if (!this.pending.delete(id)) return;
        this.emit({ type: "dismiss", id });
        reject(new Error("Cancelled"));
      }, { once: true });
    });
  }

  /** The renderer's answer to a card; one Lore did not ask for, or already settled, is refused. @param {unknown} response */
  answer(response) {
    const { id, value } = /** @type {{id?: unknown, value?: unknown}} */ (response ?? {});
    if (!response || typeof id !== "string" || !this.pending.has(id)) throw new Error("Unknown agent request");
    this.pending.get(id)?.resolve(value);
    this.pending.delete(id);
  }

  /** Every card still waiting fails with `message`, so no task waits on an owner who can no longer answer. @param {string} message */
  rejectAll(message) {
    for (const waiter of this.pending.values()) waiter.reject(new Error(message));
    this.pending.clear();
  }
}

/** The Cloudflare sign-in and page-opening steps only the owner can take, and what the agent is told of each.
 * @param {{ask: (type: AgentRequest["type"], payload: Record<string, unknown>) => Promise<unknown>,
 *   signIn: (opened: () => void) => Promise<string>, notice: () => void, openable: (url: string) => boolean}} deps */
function ownerGates({ ask, signIn, notice, openable }) {
  return {
    /** @type {LoreAgentOptions["cloudflareLogin"]} */
    cloudflareLogin: async () => {
      if (!(await ask("cloudflare", {}))) return "The owner chose not to sign in to Cloudflare right now.";
      return signIn(notice);
    },
    /** @type {LoreAgentOptions["openUrl"]} */
    openUrl: async (page) => {
      if (!openable(page.url)) return "Lore does not open that address; only Coinbase, Cloudflare and Basescan pages.";
      const answer = await ask("open", page);
      if (answer === "done") return "The owner says they finished there; verify from state before going on.";
      return answer === "stuck" ? "The owner got stuck on that page; ask what happened." : "The owner chose not to open it right now.";
    }
  };
}

module.exports = { OwnerRequests, ownerGates };
