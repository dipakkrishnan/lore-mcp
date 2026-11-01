// The bid book (contracts/bids.md): one SQLite Durable Object, the only writer of bids.
// Events are appended, never edited, and a bid's status is read from them. No method here
// can fill a bid; only the payment rail does that (MON-054).
import { DurableObject } from "cloudflare:workers";

export const LIFETIME_MS = 7 * 86_400_000;
/** The real bound on new bids: the rate-limit bindings count per location, this counts once. */
export const HOURLY_CAP = 100;
const LIVE_SHOWN = 200;
const ID_LENGTH = 10;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const UNENDED = `NOT EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = b.id AND e.type IN ('filled', 'expired', 'removed'))`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bids (
  id TEXT PRIMARY KEY, question TEXT NOT NULL, usd_cents INTEGER NOT NULL, market TEXT NOT NULL,
  email TEXT, callback_url TEXT, created TEXT NOT NULL, expires TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bid_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, bid_id TEXT NOT NULL, type TEXT NOT NULL, at TEXT NOT NULL, data TEXT);
CREATE INDEX IF NOT EXISTS bid_events_by_bid ON bid_events (bid_id, seq);
CREATE INDEX IF NOT EXISTS bids_by_created ON bids (created);
CREATE INDEX IF NOT EXISTS bids_by_expires ON bids (expires);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value);`;

// The public columns. email and callback_url are never selected for a reader.
const PUBLIC = "id, question, usd_cents, market, created, expires";

export const iso = (time) => new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");

/** removed wins, then filled, then expired (by event or by the clock), then answered, else open. */
export function statusOf(bid, events, now = Date.now()) {
  const has = (type) => events.some((e) => e.type === type);
  if (has("removed")) return "removed";
  if (has("filled")) return "filled";
  if (has("expired") || now >= Date.parse(bid.expires)) return "expired";
  if (has("answered")) return "answered";
  return "open";
}

const timeline = ({ type, at, data }) =>
  type === "answered" ? { type, at, handle: data.handle } : type === "filled" ? { type, at, rail: data.rail, proof: data.proof } : { type, at };

/** The shape every reader sees (contracts/bids.md, "Public shape"). */
export function publicBid({ bid, events }, origin, now = Date.now()) {
  return {
    id: bid.id,
    url: `${origin}/b/${bid.id}`,
    question: bid.question,
    usd: bid.usd_cents / 100,
    market: bid.market,
    status: statusOf(bid, events, now),
    created: bid.created,
    expires: bid.expires,
    answers: events
      .filter((e) => e.type === "answered")
      .map(({ at, data }) => ({ handle: data.handle, piece_url: data.piece_url, preview: data.preview, usd: data.usd_cents / 100, at })),
    events: events.map(timeline)
  };
}

function randomId() {
  let id = "";
  while (id.length < ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ID_LENGTH))) {
      // 252 is the largest multiple of 36 under 256, so every character is equally likely.
      if (byte < 252 && id.length < ID_LENGTH) id += ALPHABET[byte % 36];
    }
  }
  return id;
}

export class BidBook extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  /** Opens a bid from already-checked fields, or returns null when the hour's cap is spent. */
  place({ question, usd_cents, market, email = null, callback_url = null }, now = Date.now()) {
    const lastHour = this.sql.exec("SELECT COUNT(*) AS n FROM bids WHERE created > ?", iso(now - 3_600_000)).one().n;
    if (lastHour >= HOURLY_CAP) return null;
    const created = iso(now);
    const expires = iso(now + LIFETIME_MS);
    let id = randomId();
    while (this.sql.exec("SELECT 1 FROM bids WHERE id = ?", id).toArray().length) id = randomId();
    this.sql.exec("INSERT INTO bids VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, question, usd_cents, market, email, callback_url, created, expires);
    this.#append(id, "opened", created);
    return this.#read(id);
  }

  /** A bid and its events, or null when there is none or it was removed. */
  find(id, now = Date.now()) {
    this.#expire(now);
    const found = this.#read(id);
    return found && statusOf(found.bid, found.events, now) !== "removed" ? found : null;
  }

  /** Open and answered bids, newest first. */
  live(now = Date.now()) {
    this.#expire(now);
    const ids = this.sql
      .exec(
        `SELECT id FROM bids b WHERE expires > ? AND ${UNENDED} ORDER BY created DESC, rowid DESC LIMIT ?`,
        iso(now),
        LIVE_SHOWN
      )
      .toArray();
    return ids.map(({ id }) => this.#read(id));
  }

  /** Answered and then left to end without a fill: how often buyers walk away (MON-051). Counted as each bid ends. */
  walkedAway(now = Date.now()) {
    this.#expire(now);
    return this.#meta("walked_away") ?? 0;
  }

  /**
   * Adds a seller's answer. Returns the bid with the buyer's callback address, which the caller
   * uses to tell the buyer and never shows; or why it couldn't: "missing" or "ended".
   */
  answer(id, { handle, piece_url, preview, usd_cents }, now = Date.now()) {
    const found = this.find(id, now);
    if (!found) return "missing";
    if (!["open", "answered"].includes(statusOf(found.bid, found.events, now))) return "ended";
    this.#append(id, "answered", iso(now), { handle, piece_url, preview, usd_cents });
    const { callback_url } = this.sql.exec("SELECT callback_url FROM bids WHERE id = ?", id).one();
    return { found: this.#read(id), callback: callback_url };
  }

  /** Takes a bid down as spam. False when there is no such bid. */
  remove(id, now = Date.now()) {
    if (!this.find(id, now)) return false;
    this.#append(id, "removed", iso(now));
    return true;
  }

  #read(id) {
    const bid = this.sql.exec(`SELECT ${PUBLIC} FROM bids WHERE id = ?`, id).toArray()[0];
    if (!bid) return null;
    const events = this.sql
      .exec("SELECT type, at, data FROM bid_events WHERE bid_id = ? ORDER BY seq", id)
      .toArray()
      .map(({ type, at, data }) => ({ type, at, data: data ? JSON.parse(data) : null }));
    return { bid: { ...bid }, events };
  }

  #append(id, type, at, data = null) {
    this.sql.exec("INSERT INTO bid_events (bid_id, type, at, data) VALUES (?, ?, ?, ?)", id, type, at, data && JSON.stringify(data));
  }

  #meta(key) {
    return this.sql.exec("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value;
  }

  #setMeta(key, value) {
    this.sql.exec("INSERT INTO meta VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", key, value);
  }

  /**
   * Writes the expired event for each bid whose week ran out since the last sweep, so the timeline
   * records it. The cursor keeps each read's work to the bids that just ended, not the whole history.
   */
  #expire(now) {
    const since = this.#meta("swept") ?? "";
    const until = iso(now);
    if (until <= since) return;
    const ending = `FROM bids b WHERE expires > ? AND expires <= ? AND ${UNENDED}`;
    const walked = this.sql.exec(`SELECT COUNT(*) AS n ${ending} AND EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = b.id AND e.type = 'answered')`, since, until).one().n;
    this.sql.exec(`INSERT INTO bid_events (bid_id, type, at, data) SELECT id, 'expired', expires, NULL ${ending} ORDER BY expires`, since, until);
    this.#setMeta("swept", until);
    if (walked) this.#setMeta("walked_away", (this.#meta("walked_away") ?? 0) + walked);
  }
}
