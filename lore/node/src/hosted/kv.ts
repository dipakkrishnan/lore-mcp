/**
 * XC-088: the agents' sign-in grants and tokens (XC-068), kept in the hosted store's own database instead of a KV
 * namespace shared by every store. Only the calls `@cloudflare/workers-oauth-provider` makes are here, with KV's
 * expiry and list semantics.
 */

const SCHEMA = "CREATE TABLE IF NOT EXISTS oauth_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER, metadata TEXT)";
const LIST_LIMIT = 1000;

type Put = { expiration?: number; expirationTtl?: number; metadata?: unknown };
type Listed = { key: string; expires: number | null; metadata: string | null };

export class SqlKv {
  constructor(private readonly sql: SqlStorage) {
    sql.exec(SCHEMA);
  }

  private live(now = Date.now()): void {
    this.sql.exec("DELETE FROM oauth_kv WHERE expires IS NOT NULL AND expires <= ?", now);
  }

  async get(key: string, options?: { type?: string } | string): Promise<unknown> {
    this.live();
    const [row] = this.sql.exec<{ value: string }>("SELECT value FROM oauth_kv WHERE key = ?", key).toArray();
    if (!row) return null;
    const type = typeof options === "string" ? options : options?.type;
    if (type === undefined || type === "text") return row.value;
    if (type === "json") return JSON.parse(row.value) as unknown;
    throw new TypeError(`KV type ${type} isn't kept here`);
  }

  async put(key: string, value: string, options: Put = {}): Promise<void> {
    const expires = options.expiration !== undefined ? options.expiration * 1000 : options.expirationTtl !== undefined ? Date.now() + options.expirationTtl * 1000 : null;
    const metadata = options.metadata === undefined ? null : JSON.stringify(options.metadata);
    this.sql.exec("INSERT OR REPLACE INTO oauth_kv (key, value, expires, metadata) VALUES (?, ?, ?, ?)", key, value, expires, metadata);
  }

  async delete(key: string): Promise<void> {
    this.sql.exec("DELETE FROM oauth_kv WHERE key = ?", key);
  }

  /** Keys in order from `cursor`, which is the last key of the page before. */
  async list({ prefix = "", limit = LIST_LIMIT, cursor = "" }: { prefix?: string; limit?: number; cursor?: string } = {}) {
    this.live();
    const size = Math.min(Math.max(limit, 1), LIST_LIMIT);
    const rows = this.sql
      .exec<Listed>(
        "SELECT key, expires, metadata FROM oauth_kv WHERE substr(key, 1, length(?1)) = ?1 AND key > ?2 ORDER BY key LIMIT ?3",
        prefix,
        cursor,
        size + 1
      )
      .toArray();
    const page = rows.slice(0, size);
    const keys = page.map(({ key, expires, metadata }) => ({
      name: key,
      ...(expires === null ? {} : { expiration: Math.floor(expires / 1000) }),
      ...(metadata === null ? {} : { metadata: JSON.parse(metadata) as unknown })
    }));
    const more = rows.length > size;
    return more ? { keys, list_complete: false, cursor: page.at(-1)!.key } : { keys, list_complete: true };
  }

  get namespace(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}
