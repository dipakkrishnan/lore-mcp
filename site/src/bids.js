// The bid book (contracts/bids.md): one SQLite Durable Object, the only writer of bids.
// Events are appended, never edited, and a bid's status is read from them. Only the payment
// rail fills a bid (MON-054): checkout calls `paid` over the BidRail service binding, and no
// route reaches it. A carded bid is charged when its buyer accepts an answer, or on its own
// two days after the first answer; the alarm sends each charge to checkout once.
import { DurableObject } from "cloudflare:workers";

export const LIFETIME_MS = 7 * 86_400_000;
/** How long after the first answer a carded bid accepts it on its own, and how long a declined card has to be replaced. */
export const ACCEPT_MS = 2 * 86_400_000;
const RETRY_MS = 60_000;
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
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value);
CREATE TABLE IF NOT EXISTS buyers (
  bid_id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, customer TEXT, payment_method TEXT);
CREATE TABLE IF NOT EXISTS charges (
  seq INTEGER PRIMARY KEY, bid_id TEXT NOT NULL, payment_intent TEXT, account TEXT);`;
// A bid whose latest accepted answer has no decline after it: its charge is out.
const PAYING = `EXISTS (SELECT 1 FROM bid_events a WHERE a.bid_id = b.id AND a.type = 'accepted'
  AND NOT EXISTS (SELECT 1 FROM bid_events d WHERE d.bid_id = b.id AND d.seq > a.seq AND d.type = 'declined'))`;
// Carded bids that have an answer and no accepted event yet: the ones the clock may accept.
const WAITING = `FROM bids b JOIN buyers k ON k.bid_id = b.id WHERE k.payment_method IS NOT NULL AND ${UNENDED}
  AND EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = b.id AND e.type = 'answered')
  AND NOT EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = b.id AND e.type = 'accepted')`;
const FIRST_ANSWER = `(SELECT MIN(e.at) FROM bid_events e WHERE e.bid_id = b.id AND e.type = 'answered')`;

// The public columns. email and callback_url are never selected for a reader.
const PUBLIC = "id, question, usd_cents, market, created, expires";

export const iso = (time) => new Date(time).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The latest accepted event when its charge is still out: not followed by a decline. */
export function paying(events) {
  const last = events.findLast((e) => e.type === "accepted" || e.type === "declined");
  return last?.type === "accepted" ? last : null;
}

/** The latest decline when no charge or new card has come since. */
export const declined = (events) => {
  const last = events.findLast((e) => ["accepted", "declined", "card_updated"].includes(e.type));
  return last?.type === "declined" ? last : null;
};

/**
 * removed wins, then filled, then paying (accepted, charge out), then expired (by event, or by the
 * clock unless an accepted charge holds it), then pending (card not yet saved), answered, else open.
 */
export function statusOf(bid, events, now = Date.now()) {
  const has = (type) => events.some((e) => e.type === type);
  if (has("removed")) return "removed";
  if (has("filled")) return "filled";
  if (paying(events)) return "paying";
  if (has("expired") || (!has("accepted") && now >= Date.parse(bid.expires))) return "expired";
  if (!has("opened")) return "pending";
  if (has("answered")) return "answered";
  return "open";
}

const timeline = ({ type, at, data }) =>
  type === "answered"
    ? { type, at, handle: data.handle }
    : type === "filled"
      ? { type, at, rail: data.rail, proof: data.proof }
      : type === "accepted"
        ? { type, at, answer: data.answer, auto: data.auto }
        : { type, at };

/** For the buyer of a filled bid only: the answer's piece, opened by its payment, as a card receipt opens a piece. */
export function receiptUrl({ events }) {
  const filled = events.find((e) => e.type === "filled");
  const answer = filled && events.filter((e) => e.type === "answered")[filled.data.answer];
  return answer && filled.data.payment_intent ? `${answer.data.piece_url}?session_id=${filled.data.payment_intent}` : null;
}

/** When a carded bid with answers accepts the first one on its own: two days after it, but never after the bid's week. */
export const autoAcceptAt = (bid, events) => {
  const first = events.find((e) => e.type === "answered");
  return first ? Math.min(Date.parse(first.at) + ACCEPT_MS, Date.parse(bid.expires)) : null;
};

/** The shape every reader sees (contracts/bids.md, "Public shape"). */
export function publicBid({ bid, events }, origin, now = Date.now()) {
  return {
    id: bid.id,
    url: `${origin}/b/${bid.id}`,
    question: bid.question,
    usd: bid.usd_cents / 100,
    market: bid.market,
    status: statusOf(bid, events, now),
    card: Boolean(bid.card),
    created: bid.created,
    expires: bid.expires,
    answers: events
      .filter((e) => e.type === "answered")
      .map(({ at, data }) => ({ handle: data.handle, piece_url: data.piece_url, preview: data.preview, usd: data.usd_cents / 100, at })),
    events: events.map(timeline)
  };
}

function randomId(length = ID_LENGTH) {
  let id = "";
  while (id.length < length) {
    for (const byte of crypto.getRandomValues(new Uint8Array(length))) {
      // 252 is the largest multiple of 36 under 256, so every character is equally likely.
      if (byte < 252 && id.length < length) id += ALPHABET[byte % 36];
    }
  }
  return id;
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const digest = async (text) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
const same = (a, b) => a.length === b.length && crypto.subtle.timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));

export class BidBook extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(SCHEMA);
  }

  /**
   * Places a bid from already-checked fields, or returns null when the hour's cap is spent. A bid
   * without a card opens at once. A bid with one waits, unlisted, until checkout says the card is
   * saved; `key` is the buyer's secret for accepting, kept here only as a hash.
   */
  async place({ question, usd_cents, market, email = null, callback_url = null }, { card = false, now = Date.now() } = {}) {
    const lastHour = this.sql.exec("SELECT COUNT(*) AS n FROM bids WHERE created > ?", iso(now - 3_600_000)).one().n;
    if (lastHour >= HOURLY_CAP) return null;
    const created = iso(now);
    const expires = iso(now + LIFETIME_MS);
    let id = randomId();
    while (this.sql.exec("SELECT 1 FROM bids WHERE id = ?", id).toArray().length) id = randomId();
    this.sql.exec("INSERT INTO bids VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, question, usd_cents, market, email, callback_url, created, expires);
    if (!card) {
      this.#append(id, "opened", created, { card: false });
      return { found: this.#read(id) };
    }
    const key = randomId(32);
    this.sql.exec("INSERT INTO buyers (bid_id, key_hash) VALUES (?, ?)", id, await digest(key));
    return { found: this.#read(id), key };
  }

  /** The bid and its saved card's ids, for the buyer holding its key; null for anyone else. */
  async buyer(id, key, now = Date.now()) {
    const found = this.find(id, now);
    const row = found && this.#buyer(id);
    return row && typeof key === "string" && (await same(await digest(key), row.key_hash)) ? { found, customer: row.customer } : null;
  }

  /**
   * The buyer accepts answer `answer` (its index). Returns the bid, or why not: "missing", "card",
   * "state". Accepting the answer already being paid returns the bid again, so a repeat is harmless.
   */
  async accept(id, key, answer, now = Date.now()) {
    if (!(await this.buyer(id, key, now))) return "missing";
    // Read again after the key check's await, so the check and the append run with nothing between them.
    const { bid, events } = this.#read(id);
    if (!this.#buyer(id).payment_method) return "card";
    const answers = events.filter((e) => e.type === "answered");
    const status = statusOf(bid, events, now);
    if (status === "paying" && paying(events).data.answer === answer) return { bid, events };
    if (status !== "answered" || !Number.isInteger(answer) || !answers[answer]) return "state";
    this.#append(id, "accepted", iso(now), { answer, auto: false });
    await this.#schedule(now);
    return this.#read(id);
  }

  /**
   * Checkout saw Stripe save the buyer's card (a webhook, over BidRail). Opens a waiting bid; on a
   * bid whose charge was declined, records the new card and tries the same answer again.
   */
  async cardSaved(id, { customer, payment_method }, now = Date.now()) {
    const found = this.find(id, now);
    const row = found && this.#buyer(id);
    if (!row || row.payment_method === payment_method) return false;
    const status = statusOf(found.bid, found.events, now);
    if (!["pending", "open", "answered"].includes(status)) return false;
    this.sql.exec("UPDATE buyers SET customer = ?, payment_method = ? WHERE bid_id = ?", customer, payment_method, id);
    if (status === "pending") this.#append(id, "opened", iso(now), { card: true });
    else this.#append(id, "card_updated", iso(now));
    const refused = declined(found.events);
    if (refused) this.#append(id, "accepted", iso(now), { answer: refused.data.answer, auto: false });
    await this.#schedule(now);
    return true;
  }

  /** A placed bid whose card setup never started: removed whole, so it holds no row and no slot in the hour's cap. */
  abandon(id) {
    const found = this.#read(id);
    if (!found || found.events.length) return false;
    this.sql.exec("DELETE FROM buyers WHERE bid_id = ?", id);
    this.sql.exec("DELETE FROM bids WHERE id = ?", id);
    return true;
  }

  /**
   * Whether a Stripe report is about the charge out for this bid: the PaymentIntent Lore created
   * for the latest accepted answer, on the seller account it was created on. "pending" when that
   * charge's reply hasn't been recorded yet, so the webhook is sent again.
   */
  #outstanding(found, payment_intent, account) {
    const accepted = paying(found.events);
    if (!accepted) return { verdict: "rejected" };
    const sent = this.sql.exec("SELECT payment_intent, account FROM charges WHERE seq = ?", accepted.seq).toArray()[0];
    if (!sent) return { verdict: "pending" };
    return sent.payment_intent === payment_intent && sent.account === account ? { verdict: "ok", accepted } : { verdict: "rejected" };
  }

  /**
   * The payment rail's word that an accepted charge settled (checkout's Stripe webhook, over
   * BidRail). Fills the bid only for that exact charge, in dollars, for the full amount. Returns
   * "filled" (also for a retry of the same charge), "pending" or "rejected". Nothing else fills.
   */
  paid(id, { payment_intent, charge, amount_cents, currency, account }, now = Date.now()) {
    const found = this.#read(id);
    if (!found || found.events.some((e) => e.type === "removed")) return "rejected";
    const filled = found.events.find((e) => e.type === "filled");
    if (filled) return filled.data.payment_intent === payment_intent ? "filled" : "rejected";
    const { verdict, accepted } = this.#outstanding(found, payment_intent, account);
    if (verdict !== "ok") return verdict;
    if (currency !== "usd" || amount_cents !== found.bid.usd_cents) return "rejected";
    this.#append(id, "filled", iso(now), { rail: "card", proof: charge, payment_intent, answer: accepted.data.answer });
    return "filled";
  }

  /** The rail's word that the charge out for this bid failed after it was sent: a decline, like one at once. */
  failed(id, { payment_intent, account, message }, now = Date.now()) {
    const found = this.#read(id);
    if (!found || found.events.some((e) => e.type === "filled" || e.type === "removed")) return "rejected";
    const { verdict, accepted } = this.#outstanding(found, payment_intent, account);
    if (verdict !== "ok") return verdict;
    this.#append(id, "declined", iso(now), { answer: accepted.data.answer, reason: "failed", message });
    return "declined";
  }

  /** Accepts what the clock says is due, then sends each charge not yet sent. */
  async alarm() {
    const now = Date.now();
    this.#expire(now);
    let retry = false;
    for (const { id, seq, answer } of this.#unsent()) {
      const row = this.#buyer(id);
      const found = this.#read(id);
      const piece = found.events.filter((e) => e.type === "answered")[answer];
      try {
        const result = await this.env.CHECKOUT.charge({
          bid: id,
          attempt: `bid-${id}-${seq}`,
          customer: row.customer,
          payment_method: row.payment_method,
          piece_url: piece.data.piece_url,
          usd_cents: found.bid.usd_cents,
          question: found.bid.question
        });
        // Checkout says to try again when Stripe couldn't be reached; the same attempt id keeps it one charge.
        if (result.retry) retry = true;
        else {
          this.sql.exec("INSERT INTO charges VALUES (?, ?, ?, ?)", seq, id, result.ok ? result.payment_intent : null, result.ok ? result.account : null);
          if (!result.ok) this.#append(id, "declined", iso(Date.now()), { answer, reason: result.reason, message: result.message });
        }
      } catch (error) {
        console.error(`bid ${id}: charge not sent: ${error.message}`);
        retry = true;
      }
    }
    await this.#schedule(now, retry);
  }

  /** A bid and its events, or null when there is none or it was removed. */
  find(id, now = Date.now()) {
    this.#expire(now);
    const found = this.#read(id);
    return found && statusOf(found.bid, found.events, now) !== "removed" ? found : null;
  }

  /** Open and answered bids, carded ones first, then newest first. A bid still waiting on its card isn't listed. */
  live(now = Date.now()) {
    this.#expire(now);
    const ids = this.sql
      .exec(
        `SELECT id FROM bids b WHERE expires > ? AND ${UNENDED}
          AND EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = b.id AND e.type = 'opened')
          AND NOT ${PAYING}
          ORDER BY EXISTS (SELECT 1 FROM buyers k WHERE k.bid_id = b.id AND k.payment_method IS NOT NULL) DESC, created DESC, rowid DESC LIMIT ?`,
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

  async answer(id, { handle, piece_url, preview, usd_cents }, now = Date.now()) {
    const found = this.find(id, now);
    if (!found) return "missing";
    if (!["open", "answered"].includes(statusOf(found.bid, found.events, now))) return "ended";
    this.#append(id, "answered", iso(now), { handle, piece_url, preview, usd_cents });
    await this.#schedule(now);
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
    const bid = this.sql.exec(`SELECT ${PUBLIC}, (SELECT payment_method FROM buyers WHERE bid_id = id) IS NOT NULL AS card FROM bids WHERE id = ?`, id).toArray()[0];
    if (!bid) return null;
    const events = this.sql
      .exec("SELECT seq, type, at, data FROM bid_events WHERE bid_id = ? ORDER BY seq", id)
      .toArray()
      .map(({ seq, type, at, data }) => ({ seq, type, at, data: data ? JSON.parse(data) : null }));
    return { bid: { ...bid }, events };
  }

  #buyer(id) {
    return this.sql.exec("SELECT key_hash, customer, payment_method FROM buyers WHERE bid_id = ?", id).toArray()[0] ?? null;
  }

  /** Accepted events whose charge hasn't gone to checkout yet. */
  #unsent() {
    return this.sql
      .exec(
        `SELECT a.bid_id AS id, a.seq, a.data FROM bid_events a WHERE a.type = 'accepted'
          AND NOT EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = a.bid_id AND e.seq > a.seq AND e.type IN ('declined', 'filled', 'removed'))
          AND NOT EXISTS (SELECT 1 FROM charges c WHERE c.seq = a.seq)`
      )
      .toArray()
      .map(({ id, seq, data }) => ({ id, seq, answer: JSON.parse(data).answer }));
  }

  /** The alarm goes off at the next automatic accept, or now when a charge is waiting to go out. */
  async #schedule(now, retry = false) {
    const due = this.#unsent().length ? (retry ? now + RETRY_MS : now) : null;
    const next = this.sql.exec(`SELECT MIN(MIN(julianday(${FIRST_ANSWER}) + 2, julianday(b.expires))) AS day ${WAITING}`).one().day;
    const auto = next === null ? null : Math.round((next - 2440587.5) * 86_400_000);
    const at = [due, auto].filter((time) => time !== null);
    if (at.length) await this.ctx.storage.setAlarm(Math.max(Math.min(...at), now));
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
    this.#acceptDue(now);
    this.#endDeclined(now);
    const since = this.#meta("swept") ?? "";
    const until = iso(now);
    if (until <= since) return;
    // A bid with an accepted answer ends through its payment, not the clock.
    const ending = `FROM bids b WHERE expires > ? AND expires <= ? AND ${UNENDED}
      AND NOT EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = b.id AND e.type = 'accepted')`;
    const walked = this.sql.exec(`SELECT COUNT(*) AS n ${ending} AND EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = b.id AND e.type = 'answered')`, since, until).one().n;
    this.sql.exec(`INSERT INTO bid_events (bid_id, type, at, data) SELECT id, 'expired', expires, NULL ${ending} ORDER BY expires`, since, until);
    this.#setMeta("swept", until);
    if (walked) this.#setMeta("walked_away", (this.#meta("walked_away") ?? 0) + walked);
  }

  /** Accepts the first answer of each carded bid whose two days (or week) are up; the alarm sends the charge. */
  #acceptDue(now) {
    const due = this.sql.exec(`SELECT b.id ${WAITING} AND MIN(julianday(${FIRST_ANSWER}) + 2, julianday(b.expires)) <= julianday(?)`, iso(now)).toArray();
    for (const { id } of due) this.#append(id, "accepted", iso(now), { answer: 0, auto: true });
    if (due.length) this.ctx.storage.setAlarm(now);
  }

  /** A declined card not replaced within two days, once the bid's week is over, ends the bid unfilled. */
  #endDeclined(now) {
    const held = this.sql
      .exec(`SELECT id FROM bids b WHERE ${UNENDED} AND EXISTS (SELECT 1 FROM bid_events e WHERE e.bid_id = b.id AND e.type = 'declined')`)
      .toArray();
    for (const { id } of held) {
      const { bid, events } = this.#read(id);
      const refused = declined(events);
      if (!refused || now < Math.max(Date.parse(refused.at) + ACCEPT_MS, Date.parse(bid.expires))) continue;
      this.#append(id, "expired", iso(now));
      this.#setMeta("walked_away", (this.#meta("walked_away") ?? 0) + 1);
    }
  }
}
