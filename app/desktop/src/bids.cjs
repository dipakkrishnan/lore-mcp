const { readFile, rename, writeFile } = require("node:fs/promises");
const { plural } = require("./reading.cjs");

// APP-274: open bids on yourlore.dev that the owner already knows the answer to. The board is public and read as
// it is; `lore bids match` decides which bids the owner's memories answer, on this Mac, so nothing about a memory
// leaves it until the owner sends an answer.

const BIDS_URL = "https://yourlore.dev/bids.json";
/** Bids stay open a week, so a look every quarter hour finds each in time; coming back to the app looks sooner. */
const LOOK_EVERY_MS = 15 * 60_000;
/** Each look runs the matcher over the whole library, so coming back to the app twice in a minute looks once. */
const AT_MOST_EVERY_MS = 60_000;
/** Past this many new matches at once, one notification says how many instead of one each. */
const ONE_EACH = 3;

/** @param {number} usd */
const dollars = (usd) => `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;

/** One notification per new match, or one for the lot. @param {BidMatch[]} fresh @returns {Array<{title: string, body: string}>} */
function announcements(fresh) {
  if (fresh.length > ONE_EACH) {
    const total = fresh.reduce((sum, match) => sum + match.bid.usd, 0);
    return [{ title: `${fresh.length} bids match what you know`, body: `${dollars(total)} on offer. Your agent can draft each answer.` }];
  }
  return fresh.map((match) => ({
    title: `Someone will pay ${dollars(match.bid.usd)} for something you know`,
    body: `${match.bid.question} · ${match.memories.length === 1 ? "One of your memories answers it" : `${plural(match.memories.length, "memory")} of yours answer it`}`
  }));
}

/** The open bids the owner's memories answer, kept on disk with the ones the owner dismissed and the ones already
 * announced, so a relaunch never repeats a banner and a dismissed bid never comes back. */
class BidWatch {
  /** @type {Promise<BidMatch[]> | null} */
  #checking = null;
  #lastLook = -Infinity;

  /** @param {{file: string, match: (board: unknown) => Promise<BidMatch[]>, badge: (count: number) => void, url?: string, fetch?: typeof globalThis.fetch, now?: () => number}} options */
  constructor({ file, match, badge, url = BIDS_URL, fetch: read = globalThis.fetch, now = Date.now }) {
    this.file = file;
    this.match = match;
    this.badge = badge;
    this.url = url;
    this.fetch = read;
    this.now = now;
  }

  /** Read the board and match it; hands back the matches not announced before. Offline, it keeps what it had. */
  check() {
    this.#checking ??= this.#check().finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  /** The matches waiting on the owner, best first; any whose week ran out while Lore was closed are gone. */
  async matches() {
    const { matches } = await this.#read();
    return matches.filter((match) => Date.parse(match.bid.expires) > this.now());
  }

  /** @param {string} id */
  async find(id) {
    return (await this.matches()).find((match) => match.bid.id === id) ?? null;
  }

  /** Not this one: it leaves, and stays gone. @param {string} id */
  async dismiss(id) {
    const state = await this.#read();
    if (!state.dismissed.includes(id)) state.dismissed.push(id);
    await this.#save({ ...state, matches: state.matches.filter((match) => match.bid.id !== id) });
  }

  /** Put the badge back after a relaunch. */
  async show() {
    this.badge((await this.matches()).length);
  }

  async #check() {
    if (this.now() - this.#lastLook < AT_MOST_EVERY_MS) return [];
    this.#lastLook = this.now();
    const response = await this.fetch(this.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`The bids board answered ${response.status}`);
    const board = await response.json();
    const found = await this.match(board);
    const state = await this.#read();
    // Only ids still on the board are worth remembering; a bid that ended never comes back.
    const live = new Set((Array.isArray(board?.bids) ? board.bids : []).map((/** @type {{id: string}} */ bid) => bid.id));
    const dismissed = state.dismissed.filter((id) => live.has(id));
    const byBid = new Map(found.filter((match) => !dismissed.includes(match.bid.id)).map((match) => [match.bid.id, match]));
    const matches = [...byBid.values()];
    const fresh = matches.filter((match) => !state.announced.includes(match.bid.id));
    await this.#save({ matches, dismissed, announced: [...new Set([...state.announced.filter((id) => live.has(id)), ...byBid.keys()])] });
    return fresh;
  }

  /** @returns {Promise<{matches: BidMatch[], dismissed: string[], announced: string[]}>} */
  async #read() {
    try {
      const state = JSON.parse(await readFile(this.file, "utf8"));
      if (Array.isArray(state?.matches) && Array.isArray(state.dismissed) && Array.isArray(state.announced)) return state;
    } catch {}
    return { matches: [], dismissed: [], announced: [] };
  }

  /** Written beside the file, then renamed over it, so a crash mid-write leaves the old one whole.
   * @param {{matches: BidMatch[], dismissed: string[], announced: string[]}} state */
  async #save(state) {
    await writeFile(`${this.file}.tmp`, JSON.stringify(state));
    await rename(`${this.file}.tmp`, this.file);
    this.badge(state.matches.length);
  }
}

module.exports = { BidWatch, announcements, dollars, BIDS_URL, LOOK_EVERY_MS };
