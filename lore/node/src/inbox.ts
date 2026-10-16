import { createHash, timingSafeEqual } from "node:crypto";
import { fromB64url, hex, seal } from "./seal.js";

/**
 * What the owner's own agents write into this node (XC-067, contracts/inbox.md).
 * Saves wait here sealed to the owner's key until the Mac collects them; the
 * plaintext lives only for the length of a call. A push replaces only
 * `publications` and `node_settings`, so these tables survive it.
 */

export const LIMITS = { items: 20, keys: 50, waiting: 2_000, retention: 30 * 86_400_000 };

export const WINDOWS = [
  { span: "hour", size: 3_600_000, limit: 100, label: "100 writes an hour" },
  { span: "day", size: 86_400_000, limit: 1_000, label: "1,000 writes a day" }
] as const;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, app TEXT NOT NULL, token_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, revoked_at TEXT, last_saved_at TEXT, saved INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, agent TEXT NOT NULL, key_hash TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('waiting','forgotten','received')), sealed TEXT, saved_at TEXT NOT NULL, received_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS inbox_windows (agent TEXT NOT NULL, span TEXT NOT NULL, started TEXT NOT NULL, used INTEGER NOT NULL,
    PRIMARY KEY (agent, span))`
];

export async function ensureInboxSchema(db: D1Database): Promise<void> {
  await db.batch(SCHEMA.map((statement) => db.prepare(statement)));
}

export type Save = {
  title: string;
  content: string;
  topic?: string | null;
  kind?: string | null;
  key?: string | null;
  occurred_at?: string | null;
};
export type Failure = { error: string };
export const failed = (value: object): value is Failure => "error" in value;

/** A forget has no `save`. */
type Write = { key?: string | null; save?: Save };

type AgentRow = { id: string; token_hash: string; last_saved_at: string | null; saved: number };

const NOT_READY: Failure = { error: "Lore isn't ready for agents on this store yet" };
const NOTE = "Saved privately for the owner. It waits sealed until their Mac collects it, and nothing is published or sold without their approval.";
const BUSY: Failure = {
  error: `this agent has reached its limit of ${WINDOWS.map((window) => window.label).join(" or ")}, or the store holds ${LIMITS.waiting.toLocaleString("en-US")} waiting items; try again later`
};

const iso = (time: number) => new Date(time).toISOString();
const utf8 = new TextEncoder();

function sameHash(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(utf8.encode(a), utf8.encode(b));
}

export class Inbox {
  private constructor(
    readonly db: D1Database,
    readonly agent: AgentRow
  ) {}

  /** The inbox as the agent holding this secret sees it, or null for a wrong, rotated-out or revoked key. */
  static async open(db: D1Database, id: string, secret: string): Promise<Inbox | null> {
    await ensureInboxSchema(db);
    const row = await db.prepare("SELECT * FROM agents WHERE id = ? AND revoked_at IS NULL").bind(id).first<AgentRow>();
    const hash = createHash("sha256").update(secret).digest("hex");
    return row && sameHash(row.token_hash, hash) ? new Inbox(db, row) : null;
  }

  /** The owner's public key and HMAC salt, as the last push left them in node_settings. */
  private async keys(): Promise<{ publicKey: Uint8Array<ArrayBuffer>; salt: CryptoKey } | null> {
    const rows: Record<string, string> = await this.db
      .prepare("SELECT key, value FROM node_settings WHERE key IN ('inbox_public_key', 'inbox_salt')")
      .all<{ key: string; value: string }>()
      .then(({ results }) => Object.fromEntries(results.map(({ key, value }) => [key, value])))
      .catch(() => ({}));
    const publicKey = fromB64url(rows.inbox_public_key ?? "");
    if (publicKey.length !== 32 || !rows.inbox_salt) return null;
    const salt = await crypto.subtle.importKey("raw", fromB64url(rows.inbox_salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return { publicKey, salt };
  }

  private async keyHash(salt: CryptoKey, key: string): Promise<string> {
    return hex(await crypto.subtle.sign("HMAC", salt, utf8.encode(`${this.agent.id}:${key}`)));
  }

  private async waiting(agent: string | null = null): Promise<number> {
    const row = await this.db
      .prepare("SELECT count(*) AS n FROM inbox WHERE sealed IS NOT NULL AND (?1 IS NULL OR agent = ?1)")
      .bind(agent)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  async store(saves: Save[]) {
    const written = await this.write(saves.map((save) => ({ key: save.key, save })));
    return failed(written) ? written : { saved: written, note: NOTE };
  }

  async forget(key: string) {
    const written = await this.write([{ key }]);
    return failed(written) ? written : { forgotten: true };
  }

  async stored(keys: string[] = []) {
    const owner = await this.keys();
    if (!owner) return NOT_READY;
    const states = await Promise.all(
      keys.map(async (key) => {
        const row = await this.db
          .prepare("SELECT state, saved_at FROM inbox WHERE agent = ? AND key_hash = ? ORDER BY saved_at DESC, rowid DESC LIMIT 1")
          .bind(this.agent.id, await this.keyHash(owner.salt, key))
          .first<{ state: string; saved_at: string }>();
        return { key, state: row?.state ?? "unknown", saved_at: row?.saved_at ?? null };
      })
    );
    return { saved: this.agent.saved, waiting: await this.waiting(this.agent.id), last_saved_at: this.agent.last_saved_at, keys: states };
  }

  /** Every window with this call's writes added, or the first limit they would pass. */
  private async windows(time: number, writes: number): Promise<Failure | null> {
    const { results } = await this.db
      .prepare("SELECT span, started, used FROM inbox_windows WHERE agent = ?")
      .bind(this.agent.id)
      .all<{ span: string; started: string; used: number }>();
    const over = WINDOWS.find((window) => {
      const row = results.find(({ span }) => span === window.span);
      const used = row && time - Date.parse(row.started) < window.size ? row.used : 0;
      return used + writes > window.limit;
    });
    return over ? { error: `this agent has reached its limit of ${over.label}; try again later` } : null;
  }

  /**
   * Seal and keep a batch of writes, all or none. A save replaces the payload
   * still waiting under its key. A forget drops a waiting payload when no
   * earlier version under that key reached the Mac; otherwise it is sealed and
   * kept, so the Mac removes the memory it has.
   */
  private async write(writes: Write[]): Promise<Failure | { id: string; key: string; replaced: boolean }[]> {
    const owner = await this.keys();
    if (!owner) return NOT_READY;
    const db = this.db;
    const time = Date.now();
    const at = iso(time);
    await db.prepare("DELETE FROM inbox WHERE sealed IS NOT NULL AND saved_at <= ?").bind(iso(time - LIMITS.retention)).run();
    const refused = await this.windows(time, writes.length);
    if (refused) return refused;

    const keyed = await Promise.all(
      writes.map(async (write) => {
        const fresh = crypto.randomUUID().replace(/-/g, "");
        const key = write.key ?? fresh;
        return { write, fresh, key, hash: await this.keyHash(owner.salt, key) };
      })
    );
    const hashes = [...new Set(keyed.map(({ hash }) => hash))];
    const { results: known } = await db
      .prepare(`SELECT id, key_hash, state, sealed IS NOT NULL AS held FROM inbox WHERE agent = ? AND key_hash IN (${hashes.map(() => "?").join(", ")})`)
      .bind(this.agent.id, ...hashes)
      .all<{ id: string; key_hash: string; state: string; held: number }>();
    const held = new Map(known.filter((row) => row.held).map((row) => [row.key_hash, row.id as string | null]));
    const received = new Set(known.filter((row) => row.state === "received").map((row) => row.key_hash));

    let waiting = await this.waiting();
    const planned = keyed.map(({ write, fresh, key, hash }) => {
      const previous = held.get(hash) ?? null;
      const dropped = !write.save && previous !== null && !received.has(hash);
      const id = previous ?? fresh;
      held.set(hash, dropped ? null : id);
      waiting += (dropped ? 0 : 1) - (previous ? 1 : 0);
      const { title, content, topic = null, kind = null, occurred_at = null } = write.save ?? {};
      const plaintext = dropped ? null : JSON.stringify(write.save ? { title, content, topic, kind, key, occurred_at } : { key, forget: true });
      return { id, key, hash, state: write.save ? "waiting" : "forgotten", plaintext, replaced: previous !== null };
    });
    if (waiting > LIMITS.waiting) {
      return { error: `the store is at its limit of ${LIMITS.waiting.toLocaleString("en-US")} waiting items until the owner's Mac collects them` };
    }

    const sealed = await Promise.all(planned.map(async ({ id, plaintext }) => (plaintext === null ? null : seal(owner.publicKey, id, plaintext))));
    const saves = writes.filter((write) => write.save).length;
    const statements = [
      ...WINDOWS.map((window) =>
        db
          .prepare(
            "INSERT INTO inbox_windows (agent, span, started, used) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (agent, span) DO UPDATE SET " +
              "used = CASE WHEN started <= ?5 THEN ?4 ELSE used + ?4 END, started = CASE WHEN started <= ?5 THEN ?3 ELSE started END"
          )
          .bind(this.agent.id, window.span, at, writes.length, iso(time - window.size))
      ),
      ...planned.map(({ id, hash, state }, index) =>
        db
          .prepare(
            "INSERT INTO inbox (id, agent, key_hash, state, sealed, saved_at) VALUES (?, ?, ?, ?, ?, ?) " +
              "ON CONFLICT (id) DO UPDATE SET state = excluded.state, sealed = excluded.sealed, saved_at = excluded.saved_at"
          )
          .bind(id, this.agent.id, hash, state, sealed[index], at)
      ),
      ...(saves ? [db.prepare("UPDATE agents SET saved = saved + ?, last_saved_at = ? WHERE id = ?").bind(saves, at, this.agent.id)] : []),
      // The authoritative check, inside the batch: a concurrent write that
      // slipped past the reads above fails this NOT NULL insert, and the
      // whole batch rolls back.
      db
        .prepare(
          "INSERT INTO inbox_windows (agent, span, started, used) SELECT NULL, '', '', 0 WHERE " +
            "EXISTS (SELECT 1 FROM inbox_windows WHERE agent = ?1 AND ((span = 'hour' AND used > ?2) OR (span = 'day' AND used > ?3))) " +
            "OR (SELECT count(*) FROM inbox WHERE sealed IS NOT NULL) > ?4"
        )
        .bind(this.agent.id, WINDOWS[0].limit, WINDOWS[1].limit, LIMITS.waiting)
    ];
    try {
      await db.batch(statements);
    } catch (error) {
      if (/NOT NULL constraint failed: inbox_windows/.test(String(error))) return BUSY;
      throw error;
    }
    return planned.map(({ id, key, replaced }) => ({ id, key, replaced }));
  }
}
