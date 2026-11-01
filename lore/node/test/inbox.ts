// The owner's Mac and an owner's agent, for the XC-067 tests: the Mac side
// talks to D1 directly, as `wrangler d1 execute` does (contracts/inbox.md).
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { ensureInboxSchema } from "../src/inbox";
import { b64url, fromB64url, hex, sealingKey } from "../src/seal";

export const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => exports.default.fetch(input, init)) as typeof fetch;

/** The owner side of contracts/inbox.md "Sealing". */
export async function open(privateKey: CryptoKey, ownerPublic: Uint8Array<ArrayBuffer>, itemId: string, sealed: string): Promise<unknown> {
  const bytes = fromB64url(sealed);
  const eph = bytes.slice(0, 32);
  const key = await sealingKey(privateKey, eph, new Uint8Array([...eph, ...ownerPublic]));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(32, 44), additionalData: new TextEncoder().encode(itemId) }, key, bytes.slice(44));
  return JSON.parse(new TextDecoder().decode(plain)) as unknown;
}

export async function ownerKey(): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer> }> {
  const pair = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  return { privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)) };
}

type Item = { id: string; agent: string; state: string; sealed: string; saved_at: string };

export class Mac {
  private constructor(readonly key: { privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer> }) {}

  /** A Mac whose push has left its inbox keys in node_settings. */
  static async pushed(): Promise<Mac> {
    const mac = new Mac(await ownerKey());
    await ensureInboxSchema(env.LORE_DB);
    await mac.push();
    return mac;
  }

  /** What `lore push` does to node_settings, inbox keys included. */
  async push(settings: Record<string, string> = {}): Promise<void> {
    const values = { inbox_public_key: b64url(this.key.publicKey), inbox_salt: b64url(new Uint8Array(32).fill(7)), ...settings };
    await env.LORE_DB.batch([
      env.LORE_DB.prepare("DROP TABLE IF EXISTS node_settings"),
      env.LORE_DB.prepare("CREATE TABLE node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
      ...Object.entries(values).map(([key, value]) => env.LORE_DB.prepare("INSERT INTO node_settings (key, value) VALUES (?, ?)").bind(key, value))
    ]);
  }

  async mint(name = "Grok", app = "grok"): Promise<{ id: string; token: string }> {
    const id = hex(crypto.getRandomValues(new Uint8Array(8)));
    const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await env.LORE_DB.prepare("INSERT INTO agents (id, name, app, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, name, app, createHash("sha256").update(secret).digest("hex"), new Date().toISOString())
      .run();
    return { id, token: `lore_agent_${id}_${secret}` };
  }

  async rotate(id: string): Promise<string> {
    const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
    await env.LORE_DB.prepare("UPDATE agents SET token_hash = ? WHERE id = ?").bind(createHash("sha256").update(secret).digest("hex"), id).run();
    return `lore_agent_${id}_${secret}`;
  }

  /** What Allow on the Mac does (XC-068): a new agent, made only while the sign-in still waits, and the sign-in bound to it. */
  async allow(code: string, name = "Claude", app = "claude"): Promise<string | null> {
    const id = hex(crypto.getRandomValues(new Uint8Array(8)));
    const hash = createHash("sha256").update(b64url(crypto.getRandomValues(new Uint8Array(32)))).digest("hex");
    const now = new Date().toISOString();
    const waiting = "EXISTS (SELECT 1 FROM sign_ins WHERE code = ?1 AND state = 'pending' AND expires_at > ?2)";
    const [made] = await env.LORE_DB.batch([
      env.LORE_DB.prepare(`INSERT INTO agents (id, name, app, token_hash, created_at) SELECT ?3, ?4, ?5, ?6, ?2 WHERE ${waiting}`).bind(code, now, id, name, app, hash),
      env.LORE_DB.prepare("UPDATE sign_ins SET state = 'allowed', agent = ?3 WHERE code = ?1 AND state = 'pending' AND expires_at > ?2").bind(code, now, id)
    ]);
    return made.meta.changes ? id : null;
  }

  async deny(code: string): Promise<void> {
    await env.LORE_DB.prepare("UPDATE sign_ins SET state = 'denied' WHERE code = ? AND state = 'pending'").bind(code).run();
  }

  async revoke(id: string): Promise<void> {
    await env.LORE_DB.prepare("UPDATE agents SET revoked_at = ? WHERE id = ?").bind(new Date().toISOString(), id).run();
  }

  async collect(agent: string): Promise<Item[]> {
    const { results } = await env.LORE_DB.prepare(
      "SELECT id, agent, state, sealed, saved_at FROM inbox WHERE agent = ? AND state IN ('waiting','forgotten') AND sealed IS NOT NULL ORDER BY saved_at, rowid LIMIT 200"
    )
      .bind(agent)
      .all<Item>();
    return results;
  }

  async opened(agent: string): Promise<{ id: string; state: string; plain: Record<string, unknown> }[]> {
    return Promise.all(
      (await this.collect(agent)).map(async (item) => ({
        id: item.id,
        state: item.state,
        plain: (await open(this.key.privateKey, this.key.publicKey, item.id, item.sealed)) as Record<string, unknown>
      }))
    );
  }

  async confirm(items: { id: string; saved_at: string }[]): Promise<void> {
    await env.LORE_DB.batch(
      items.map(({ id, saved_at }) =>
        env.LORE_DB.prepare(
          "UPDATE inbox SET state = CASE state WHEN 'forgotten' THEN 'forgotten' ELSE 'received' END, sealed = NULL, received_at = ? WHERE id = ? AND saved_at = ?"
        ).bind(new Date().toISOString(), id, saved_at)
      )
    );
  }
}

export async function connect(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: "lore-agent-test", version: "0.1.0" });
  const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: workerFetch, requestInit }));
  return client;
}

export class Agent {
  private constructor(readonly client: Client) {}

  static async connect(token: string): Promise<Agent> {
    return new Agent(await connect("https://worker.test/agent", token));
  }

  async tool(name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: Record<string, unknown> & { error?: string } }> {
    const result = await this.client.callTool({ name, arguments: args });
    const text = (result.content as { text: string }[])[0].text;
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = { error: text };
    }
    return { isError: result.isError === true, body };
  }

  store(...items: Record<string, unknown>[]) {
    return this.tool("store", { items });
  }
}

export function memory(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: "How I price sync placements", content: "Quote off the show's budget tier, not the song.", topic: "music licensing", kind: "experience", ...overrides };
}
