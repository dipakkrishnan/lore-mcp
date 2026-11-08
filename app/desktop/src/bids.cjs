const { randomUUID } = require("node:crypto");
const { readFile, rename, writeFile } = require("node:fs/promises");
const { plural } = require("./reading.cjs");

// APP-274: open bids on yourlore.dev that the owner already knows the answer to. `lore bids match` decides which bids
// the owner's memories answer, on this Mac. Reading the board tells yourlore.dev only that this Mac's address looks
// every quarter hour or so; no memory, match or dismissal leaves the Mac until the owner sends an answer.

const BIDS_URL = "https://yourlore.dev/bids.json";
/** Bids stay open a week, so a look every quarter hour finds each in time. */
const LOOK_EVERY_MS = 15 * 60_000;
/** Each look lands up to this share of the interval early or late, so the board can't time the owner's day by it. */
const JITTER = 0.2;
/** The board is public, so what Lore reads of it is bounded: bytes, bids, and each question's length, as contracts/bids.md caps it. */
const BOARD_BYTES = 1_000_000;
const BIDS_AT_MOST = 200;
const QUESTION_AT_MOST = 280;
const BID_ID = /^[a-z0-9]{10}$/;
/** Past this many new matches at once, one notification says how many instead of one each. */
const ONE_EACH = 3;

/** @param {number} usd */
const dollars = (usd) => `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`;

/** How long until the next look. @param {() => number} [random] */
const nextLook = (random = Math.random) => Math.round(LOOK_EVERY_MS * (1 - JITTER + 2 * JITTER * random()));

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

/** The bids worth matching from what the board said: well-formed, within the caps, at most BIDS_AT_MOST.
 * @param {unknown} board @returns {Array<Record<string, unknown>>} */
function boardBids(board) {
  const listed = /** @type {{bids?: unknown}} */ (board)?.bids;
  return (Array.isArray(listed) ? listed : [])
    .filter((bid) => BID_ID.test(bid?.id) && typeof bid.question === "string" && bid.question.length <= QUESTION_AT_MOST && Number.isFinite(bid.usd) && typeof bid.expires === "string")
    .slice(0, BIDS_AT_MOST);
}

/** What the Bids page shows of a bid on the board, and nothing more. @param {Record<string, unknown>} bid @returns {BoardBid} */
const boardBid = ({ id, question, usd, market, url, expires }) => /** @type {BoardBid} */ ({ id, question, usd, market: typeof market === "string" ? market : "", url: typeof url === "string" ? url : "", expires });

/** The open bids the owner's memories answer, and the last board read (APP-288), kept on disk with the ones the owner dismissed and the ones already
 * announced, so a relaunch never repeats a banner and a dismissed bid never comes back. Every change to the file goes
 * through one queue, so a dismissal never crosses a look. */
class BidWatch {
  /** @type {Promise<BidMatch[]> | null} */
  #checking = null;
  /** The last change to the file; the next waits for it. @type {Promise<unknown>} */
  #writing = Promise.resolve();

  /** @param {{file: string, match: (board: {bids: Array<Record<string, unknown>>}) => Promise<BidMatch[]>, badge: (count: number) => void, url?: string, fetch?: typeof globalThis.fetch, now?: () => number}} options */
  constructor({ file, match, badge, url = BIDS_URL, fetch: read = globalThis.fetch, now = Date.now }) {
    this.file = file;
    this.match = match;
    this.badge = badge;
    this.url = url;
    this.fetch = read;
    this.now = now;
  }

  /** Read the board and match it; hands back the matches not yet announced. Offline, it keeps what it had. */
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

  /** APP-288: the open bids the last look read, less the ones the owner dismissed; the Bids page lists these. */
  async board() {
    const { board = [], dismissed } = await this.#read();
    return board.filter((bid) => !dismissed.includes(bid.id) && Date.parse(bid.expires) > this.now());
  }

  /** @param {string} id */
  async find(id) {
    return (await this.matches()).find((match) => match.bid.id === id) ?? null;
  }

  /** The owner was told of these, so they are never announced again. Called once the banner is up. @param {string[]} ids */
  announced(ids) {
    return this.#change((state) => ({ ...state, announced: [...new Set([...state.announced, ...ids])] }));
  }

  /** Not this one: it leaves, and stays gone. @param {string} id */
  dismiss(id) {
    return this.#change((state) => ({
      ...state,
      dismissed: state.dismissed.includes(id) ? state.dismissed : [...state.dismissed, id],
      matches: state.matches.filter((match) => match.bid.id !== id)
    }));
  }

  /** Put the badge back after a relaunch. */
  async show() {
    this.badge((await this.matches()).length);
  }

  async #check() {
    const response = await this.fetch(this.url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`The bids board answered ${response.status}`);
    if (Number(response.headers.get("content-length")) > BOARD_BYTES) throw new Error("The bids board sent too much");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > BOARD_BYTES) throw new Error("The bids board sent too much");
    const bids = boardBids(JSON.parse(new TextDecoder().decode(bytes)));
    const found = bids.length ? await this.match({ bids }) : [];
    // Only ids still on the board are worth remembering; a bid that ended never comes back.
    const live = new Set(bids.map((bid) => /** @type {string} */ (bid.id)));
    const state = await this.#change((state) => {
      const dismissed = state.dismissed.filter((id) => live.has(id));
      const matches = [...new Map(found.filter((match) => !dismissed.includes(match.bid.id)).map((match) => [match.bid.id, match])).values()];
      return { matches, dismissed, announced: state.announced.filter((id) => live.has(id)), board: bids.map(boardBid) };
    });
    return state.matches.filter((match) => !state.announced.includes(match.bid.id));
  }

  /** One read-modify-write, after any under way. @param {(state: BidState) => BidState} next @returns {Promise<BidState>} */
  #change(next) {
    const turn = this.#writing.then(async () => {
      const state = next(await this.#read());
      await this.#save(state);
      return state;
    });
    this.#writing = turn.catch(() => {});
    return turn;
  }

  /** @returns {Promise<BidState>} */
  async #read() {
    try {
      const state = JSON.parse(await readFile(this.file, "utf8"));
      if (Array.isArray(state?.matches) && Array.isArray(state.dismissed) && Array.isArray(state.announced)) return state;
    } catch {}
    return { matches: [], dismissed: [], announced: [] };
  }

  /** Written beside the file under a name of its own, then renamed over it, so a crash mid-write leaves the old one whole.
   * @param {BidState} state */
  async #save(state) {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state));
    await rename(temporary, this.file);
    this.badge(state.matches.length);
  }
}

/** @typedef {{matches: BidMatch[], dismissed: string[], announced: string[], board?: BoardBid[]}} BidState */

module.exports = { BidWatch, announcements, boardBids, nextLook, dollars, BIDS_URL, LOOK_EVERY_MS, BIDS_AT_MOST };
