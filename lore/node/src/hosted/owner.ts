import { fromB64url, hex } from "../seal.js";

/**
 * XC-088: only the owner's Mac can change a hosted store. It holds an Ed25519 key in the Keychain, and signs every
 * request with it (contracts/hosted-inbox.md). The store learns the public half when the Mac claims it, and from then
 * on takes nothing unsigned: there is no token to leak, and Lore can't sign for the owner.
 */

export const SKEW_MS = 300_000;
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id = 1), key TEXT NOT NULL, claimed_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS owner_nonces (nonce TEXT PRIMARY KEY, at INTEGER NOT NULL)"
];
const NONCE = /^[A-Za-z0-9_-]{22,64}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;

export type Refusal = { status: number; error: string };

/** What the Mac signs: the request, bound to this store's address, a moment and a nonce. */
export async function signed(method: string, url: URL, time: string, nonce: string, body: ArrayBuffer): Promise<Uint8Array<ArrayBuffer>> {
  const digest = hex(await crypto.subtle.digest("SHA-256", body));
  return new TextEncoder().encode(["lore-owner-v1", method, url.host, url.pathname, time, nonce, digest].join("\n"));
}

export class Owner {
  constructor(private readonly sql: SqlStorage) {}

  /** Whether anyone claimed this store, without writing to a store nobody did. */
  claimed(): boolean {
    const [table] = this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'owner'").toArray();
    return Boolean(table) && this.sql.exec("SELECT 1 FROM owner").toArray().length > 0;
  }

  private key(): string | null {
    if (!this.claimed()) return null;
    return this.sql.exec<{ key: string }>("SELECT key FROM owner WHERE id = 1").one().key;
  }

  /**
   * The first Mac to sign a claim with its key owns the store; the same key claiming again is a no-op, so a Mac that
   * lost the answer can ask again. Any other key is refused.
   */
  async claim(request: Request, body: ArrayBuffer): Promise<Refusal | null> {
    let key: unknown;
    try {
      key = (JSON.parse(new TextDecoder().decode(body)) as { key?: unknown }).key;
    } catch {
      return { status: 400, error: "a claim is JSON with the store's public key" };
    }
    if (typeof key !== "string" || !KEY.test(key)) return { status: 400, error: "a claim is JSON with the store's public key" };
    const known = this.key();
    if (known !== null && known !== key) return { status: 409, error: "this store belongs to someone else" };
    const refused = await this.verify(request, body, key);
    if (refused) return refused;
    for (const statement of SCHEMA) this.sql.exec(statement);
    this.sql.exec("INSERT OR IGNORE INTO owner (id, key, claimed_at) VALUES (1, ?, ?)", key, new Date().toISOString());
    // Two claims can both get this far: the first insert wins, and the other key hears it lost.
    return this.key() === key ? null : { status: 409, error: "this store belongs to someone else" };
  }

  /** A request this store's owner signed, once, within a few minutes of now; otherwise why not. */
  async check(request: Request, body: ArrayBuffer): Promise<Refusal | null> {
    const key = this.key();
    if (key === null) return { status: 404, error: "no store here" };
    return this.verify(request, body, key);
  }

  private async verify(request: Request, body: ArrayBuffer, key: string): Promise<Refusal | null> {
    const unsigned = { status: 401, error: "this request isn't signed by the store's owner" };
    const time = request.headers.get("lore-time") ?? "";
    const nonce = request.headers.get("lore-nonce") ?? "";
    const signature = fromB64url(request.headers.get("lore-signature") ?? "");
    if (!/^\d{13}$/.test(time) || !NONCE.test(nonce) || signature.length !== 64) return unsigned;
    const now = Date.now();
    if (Math.abs(now - Number(time)) > SKEW_MS) return { status: 401, error: "this request's time is too far from now; check the Mac's clock" };
    const message = await signed(request.method, new URL(request.url), time, nonce, body);
    const publicKey = await crypto.subtle.importKey("raw", fromB64url(key), { name: "Ed25519" }, false, ["verify"]);
    if (!(await crypto.subtle.verify({ name: "Ed25519" }, publicKey, signature, message))) return unsigned;
    for (const statement of SCHEMA) this.sql.exec(statement);
    this.sql.exec("DELETE FROM owner_nonces WHERE at <= ?", now - 2 * SKEW_MS);
    // Within the window a nonce is used once: a request caught on the wire can't be sent again.
    if (this.sql.exec("INSERT OR IGNORE INTO owner_nonces (nonce, at) VALUES (?, ?)", nonce, now).rowsWritten === 0) return unsigned;
    return null;
  }
}

