import { DurableObject } from "cloudflare:workers";
import { type Failure, fail, failed } from "./http.js";
import { LIMITS, type Save, WINDOWS } from "./limits.js";
import { seal } from "./seal.js";
import { Token, fromB64url, hex, randomHex, randomSecret, sameHash, sha256 } from "./token.js";

type Row = Record<string, SqlStorageValue>;

interface OwnerRow extends Row {
  owner: string;
  secret_hash: string;
  public_key: string;
  salt: string;
  created_at: string;
}

interface AgentRow extends Row {
  id: string;
  name: string;
  app: string;
  token_hash: string;
  created_at: string;
  revoked_at: string | null;
  last_saved_at: string | null;
  saved: number;
}

interface ItemRow extends Row {
  id: string;
  agent: string;
  state: string;
  sealed: string;
  saved_at: string;
}

/** One write in a store or forget call; a forget has no `save`. */
type Write = { key?: string | null; save?: Save };

const SCHEMA = `
  CREATE TABLE owner (owner TEXT NOT NULL, secret_hash TEXT NOT NULL, public_key TEXT NOT NULL, salt TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, app TEXT NOT NULL, token_hash TEXT NOT NULL, created_at TEXT NOT NULL,
    revoked_at TEXT, last_saved_at TEXT, saved INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE items (id TEXT PRIMARY KEY, agent TEXT NOT NULL, key_hash TEXT NOT NULL, state TEXT NOT NULL, sealed TEXT,
    saved_at TEXT NOT NULL, received_at TEXT);
  CREATE INDEX items_by_key ON items (agent, key_hash);
  CREATE TABLE windows (agent TEXT NOT NULL, span TEXT NOT NULL, started INTEGER NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (agent, span));
`;

const UNAUTHORIZED = fail(401, "this token is not valid");
const REVOKED = fail(401, "this agent token no longer works; the owner can issue a new one in the Lore app");
const NOTE = "Saved privately for the owner. Nothing reaches their Lore until their Mac collects it, and nothing is published or sold without their approval.";

const now = () => new Date().toISOString();
const utf8 = new TextEncoder();

/**
 * One owner's inbox (XC-067, contracts/inbox.md). The only authority for its
 * tokens and quotas. Items arrive sealed to the owner's public key; plaintext
 * is held only for the length of a call and never stored.
 */
export class Inbox extends DurableObject<Env> {
  private rows<T extends Row>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(query, ...bindings).toArray();
  }

  private exec(query: string, ...bindings: SqlStorageValue[]): void {
    this.ctx.storage.sql.exec(query, ...bindings);
  }

  /** Tables exist only once an owner registers, so a stray token never leaves storage behind. */
  private get registered(): boolean {
    return this.rows("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'owner'").length > 0;
  }

  private get record(): OwnerRow {
    return this.rows<OwnerRow>("SELECT * FROM owner")[0];
  }

  private async owner(secret: string): Promise<OwnerRow | null> {
    if (!this.registered) return null;
    const hash = await sha256(secret);
    return sameHash(this.record.secret_hash, hash) ? this.record : null;
  }

  private async agent(secret: string): Promise<AgentRow | null> {
    if (!this.registered) return null;
    const hash = await sha256(secret);
    return this.rows<AgentRow>("SELECT * FROM agents WHERE revoked_at IS NULL").find((row) => sameHash(row.token_hash, hash)) ?? null;
  }

  private waiting(agent: string | null = null): number {
    return this.rows<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE sealed IS NOT NULL AND (? IS NULL OR agent = ?)", agent, agent)[0].n;
  }

  private describe(row: AgentRow) {
    const { id, name, app, created_at, last_saved_at, saved } = row;
    return { id, name, app, created_at, last_saved_at, saved, waiting: this.waiting(id), revoked: row.revoked_at !== null };
  }

  private async keyHash(agent: string, key: string): Promise<string> {
    const salt = await crypto.subtle.importKey("raw", fromB64url(this.record.salt), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    return hex(await crypto.subtle.sign("HMAC", salt, utf8.encode(`${agent}:${key}`)));
  }

  async register(owner: string, publicKey: string, secret: string): Promise<boolean> {
    const hash = await sha256(secret);
    if (this.registered) return false;
    this.exec(SCHEMA);
    this.exec("INSERT INTO owner VALUES (?, ?, ?, ?, ?)", owner, hash, publicKey, randomSecret(), now());
    return true;
  }

  async summary(secret: string) {
    const owner = await this.owner(secret);
    if (!owner) return UNAUTHORIZED;
    const agents = this.rows<AgentRow>("SELECT * FROM agents ORDER BY created_at, id").map((row) => this.describe(row));
    return { owner: owner.owner, waiting: this.waiting(), agents };
  }

  async addAgent(secret: string, name: string, app: string) {
    const owner = await this.owner(secret);
    if (!owner) return UNAUTHORIZED;
    const id = randomHex(8);
    const token = Token.mint("agent", owner.owner);
    this.exec("INSERT INTO agents (id, name, app, token_hash, created_at) VALUES (?, ?, ?, ?, ?)", id, name, app, await sha256(token.secret), now());
    return { agent: this.describe(this.rows<AgentRow>("SELECT * FROM agents WHERE id = ?", id)[0]), token: String(token) };
  }

  async rotate(secret: string, id: string) {
    const owner = await this.owner(secret);
    if (!owner) return UNAUTHORIZED;
    const [agent] = this.rows<AgentRow>("SELECT * FROM agents WHERE id = ?", id);
    if (!agent) return fail(404, "no such agent");
    if (agent.revoked_at) return fail(409, "this agent was removed; add it again to get a new token");
    const token = Token.mint("agent", owner.owner);
    this.exec("UPDATE agents SET token_hash = ? WHERE id = ?", await sha256(token.secret), id);
    return { token: String(token) };
  }

  async revoke(secret: string, id: string) {
    if (!(await this.owner(secret))) return UNAUTHORIZED;
    if (!this.rows("SELECT 1 FROM agents WHERE id = ?", id).length) return fail(404, "no such agent");
    this.exec("UPDATE agents SET revoked_at = coalesce(revoked_at, ?) WHERE id = ?", now(), id);
    return null;
  }

  async items(secret: string, agent: string | null, limit: number) {
    if (!(await this.owner(secret))) return UNAUTHORIZED;
    const items = this.rows<ItemRow>(
      "SELECT id, agent, state, sealed, saved_at FROM items WHERE sealed IS NOT NULL AND (? IS NULL OR agent = ?) ORDER BY saved_at, rowid LIMIT ?",
      agent,
      agent,
      limit
    );
    return { items };
  }

  /** The payload goes; the row stays as a record. A collected forget stays `forgotten`, so `stored` can still say so. */
  async received(secret: string, ids: string[]) {
    if (!(await this.owner(secret))) return UNAUTHORIZED;
    const at = now();
    for (const id of ids) {
      this.exec(
        "UPDATE items SET sealed = NULL, received_at = ?, state = CASE state WHEN 'forgotten' THEN 'forgotten' ELSE 'received' END WHERE id = ? AND sealed IS NOT NULL",
        at,
        id
      );
    }
    return null;
  }

  async erase(secret: string) {
    if (!(await this.owner(secret))) return UNAUTHORIZED;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    return null;
  }

  async knows(secret: string): Promise<boolean> {
    return (await this.agent(secret)) !== null;
  }

  async store(secret: string, saves: Save[]) {
    const written = await this.write(
      secret,
      saves.map((save) => ({ key: save.key, save }))
    );
    return failed(written) ? written : { saved: written, note: NOTE };
  }

  async forget(secret: string, key: string) {
    const written = await this.write(secret, [{ key }]);
    return failed(written) ? written : { forgotten: true };
  }

  async stored(secret: string, keys: string[] = []) {
    const agent = await this.agent(secret);
    if (!agent) return REVOKED;
    const states = await Promise.all(
      keys.map(async (key) => {
        const hash = await this.keyHash(agent.id, key);
        const [row] = this.rows<ItemRow>("SELECT state, saved_at FROM items WHERE agent = ? AND key_hash = ? ORDER BY saved_at DESC, rowid DESC LIMIT 1", agent.id, hash);
        return { key, state: row?.state ?? "unknown", saved_at: row?.saved_at ?? null };
      })
    );
    return { saved: agent.saved, waiting: this.waiting(agent.id), last_saved_at: agent.last_saved_at, keys: states };
  }

  /**
   * Seal and keep a batch of writes, all or none. A write replaces the payload
   * still held under its key. A forget drops a held payload the Mac never saw;
   * otherwise it is sealed and kept, so the Mac removes the memory it has.
   */
  private write(secret: string, writes: Write[]): Promise<Failure | { id: string; key: string; replaced: boolean }[]> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const agent = await this.agent(secret);
      if (!agent) return REVOKED;
      const windows = this.windows(agent.id, writes.length);
      if (failed(windows)) return windows;
      const keyed = await Promise.all(
        writes.map(async (write) => {
          const fresh = randomHex(16);
          const key = write.key ?? fresh;
          return { write, fresh, key, hash: await this.keyHash(agent.id, key) };
        })
      );
      const held = new Map<string, string | null>();
      let waiting = this.waiting();
      const planned = keyed.map(({ write, fresh, key, hash }) => {
        const previous = held.has(hash)
          ? held.get(hash)
          : (this.rows<{ id: string }>("SELECT id FROM items WHERE agent = ? AND key_hash = ? AND sealed IS NOT NULL", agent.id, hash)[0]?.id ?? null);
        const dropped = !write.save && previous && !this.rows("SELECT 1 FROM items WHERE agent = ? AND key_hash = ? AND state = 'received'", agent.id, hash).length;
        const id = previous ?? fresh;
        held.set(hash, dropped ? null : id);
        waiting += (dropped ? 0 : 1) - (previous ? 1 : 0);
        const { title, content, topic = null, kind = null, occurred_at = null } = write.save ?? {};
        const plaintext = dropped ? null : JSON.stringify(write.save ? { title, content, topic, kind, key, occurred_at } : { key, forget: true });
        return { id, key, hash, state: write.save ? "waiting" : "forgotten", plaintext, replaced: previous !== null };
      });
      if (waiting > LIMITS.waiting) {
        return fail(429, `the owner's inbox is at its limit of ${LIMITS.waiting.toLocaleString("en-US")} waiting items until their Mac collects them`);
      }
      const publicKey = fromB64url(this.record.public_key);
      const sealed = await Promise.all(planned.map(async ({ id, plaintext }) => (plaintext === null ? null : seal(publicKey, id, plaintext))));
      const at = now();
      planned.forEach(({ id, hash, state }, index) =>
        this.exec(
          "INSERT INTO items (id, agent, key_hash, state, sealed, saved_at) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(id) DO UPDATE SET state = excluded.state, sealed = excluded.sealed, saved_at = excluded.saved_at",
          id,
          agent.id,
          hash,
          state,
          sealed[index],
          at
        )
      );
      const saves = writes.filter((write) => write.save).length;
      if (saves) this.exec("UPDATE agents SET saved = saved + ?, last_saved_at = ? WHERE id = ?", saves, at, agent.id);
      for (const { span, started, used } of windows) {
        this.exec("INSERT OR REPLACE INTO windows (agent, span, started, used) VALUES (?, ?, ?, ?)", agent.id, span, started, used);
      }
      await this.schedule();
      return planned.map(({ id, key, replaced }) => ({ id, key, replaced }));
    });
  }

  /** Every window with this call's writes added, or the first limit they would pass. */
  private windows(agent: string, writes: number) {
    const time = Date.now();
    const state = WINDOWS.map((window) => {
      const [row] = this.rows<{ started: number; used: number }>("SELECT started, used FROM windows WHERE agent = ? AND span = ?", agent, window.span);
      const expired = !row || time - row.started >= window.size;
      return { window, span: window.span, started: expired ? time : row.started, used: (expired ? 0 : row.used) + writes };
    });
    const over = state.find(({ window, used }) => used > window.limit);
    return over ? fail(429, `this agent has reached its limit of ${over.window.label}; try again later`) : state;
  }

  private async schedule(): Promise<void> {
    const [{ oldest }] = this.rows<{ oldest: string | null }>("SELECT MIN(saved_at) AS oldest FROM items WHERE sealed IS NOT NULL");
    if (oldest) await this.ctx.storage.setAlarm(Date.parse(oldest) + LIMITS.retention);
    else await this.ctx.storage.deleteAlarm();
  }

  /** Drop payloads still waiting after 30 days. */
  async alarm(): Promise<void> {
    if (!this.registered) return;
    this.exec("DELETE FROM items WHERE sealed IS NOT NULL AND saved_at <= ?", new Date(Date.now() - LIMITS.retention).toISOString());
    await this.schedule();
  }
}
