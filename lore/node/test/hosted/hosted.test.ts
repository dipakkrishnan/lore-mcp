// XC-088: Lore's hosted stores. An owner's Mac claims one with its key and changes it only with signed requests;
// their agents save to it exactly as they do to an owner's own node (contracts/hosted-inbox.md).
import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { type HostedEnv, HostedStore } from "../../src/hosted/index";
import { SqlKv } from "../../src/hosted/kv";
import { signed } from "../../src/hosted/owner";
import { statements } from "../../src/hosted/sql";
import vector from "../../../../contracts/hosted_owner_vector.json";
import { b64url, fromB64url, hex } from "../../src/seal";
import { memory, open, ownerKey } from "../inbox";

const hosted = env as unknown as HostedEnv;
// Each request comes from an address of its own, so only the test of the limit on new stores meets it.
const hostedFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init);
  if (!request.headers.has("cf-connecting-ip")) request.headers.set("cf-connecting-ip", `198.51.100.${Math.floor(Math.random() * 256)}`);
  return exports.default.fetch(request);
}) as typeof fetch;
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

const newStore = () => [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => ALPHABET[byte % 32]).join("");
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** The same statements lore/inbox.py sends: the tables, then the rows. */
const SCHEMA = `CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, app TEXT NOT NULL, token_hash TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT, last_saved_at TEXT, saved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, agent TEXT NOT NULL, key_hash TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('waiting','forgotten','received')), sealed TEXT, saved_at TEXT NOT NULL, received_at TEXT);
CREATE TABLE IF NOT EXISTS inbox_windows (agent TEXT NOT NULL, span TEXT NOT NULL, started TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (agent, span));
CREATE TABLE IF NOT EXISTS node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sign_ins (id TEXT PRIMARY KEY, code TEXT NOT NULL, client TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending','allowed','denied')), agent TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
`;

type Item = { id: string; agent: string; state: string; sealed: string; saved_at: string };

/** An owner's Mac: its signing key, its sealing key, and the store it claimed. */
class Mac {
  private constructor(
    readonly store: string,
    readonly signing: CryptoKeyPair,
    readonly sealing: { privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer> }
  ) {}

  static async claimed(store = newStore()): Promise<Mac> {
    const mac = new Mac(store, (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])), await ownerKey());
    expect((await mac.claim()).status).toBe(200);
    await mac.sql(SCHEMA + mac.settings());
    return mac;
  }

  get origin(): string {
    return `https://${this.store}.yourlore.test`;
  }

  async publicKey(): Promise<string> {
    return b64url(new Uint8Array((await crypto.subtle.exportKey("raw", this.signing.publicKey))));
  }

  /** A request signed as contracts/hosted-inbox.md says, with what to change about it for a test. */
  async signedRequest(path: string, body: string, change: { time?: number; nonce?: string; to?: string; signFor?: string; key?: CryptoKey } = {}): Promise<Request> {
    const url = new URL(path, change.to ?? this.origin);
    const time = String(change.time ?? Date.now());
    const nonce = change.nonce ?? b64url(crypto.getRandomValues(new Uint8Array(16)));
    const bytes = new TextEncoder().encode(body);
    const message = await signed("POST", new URL(path, change.signFor ?? url.origin), time, nonce, bytes.buffer);
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, change.key ?? this.signing.privateKey, message);
    return new Request(url, { method: "POST", body: bytes, headers: { "content-type": "application/json", "lore-time": time, "lore-nonce": nonce, "lore-signature": b64url(new Uint8Array(signature)) } });
  }

  async claim(change: { key?: string; signWith?: CryptoKey } = {}): Promise<Response> {
    const body = JSON.stringify({ key: change.key ?? (await this.publicKey()) });
    return hostedFetch(await this.signedRequest("/claim", body, { key: change.signWith }));
  }

  async sql(script: string): Promise<Record<string, unknown>[][]> {
    const response = await hostedFetch(await this.signedRequest("/owner/sql", JSON.stringify({ sql: script })));
    const body = await response.json<{ results?: Record<string, unknown>[][]; error?: string }>();
    if (!response.ok) throw new Error(body.error);
    return body.results ?? [];
  }

  settings(): string {
    const values = { inbox_public_key: b64url(this.sealing.publicKey), inbox_salt: b64url(new Uint8Array(32).fill(7)) };
    return Object.entries(values)
      .map(([key, value]) => `INSERT OR REPLACE INTO node_settings(key,value) VALUES (${quote(key)},${quote(value)});\n`)
      .join("");
  }

  async mint(): Promise<{ id: string; token: string }> {
    const id = hex(crypto.getRandomValues(new Uint8Array(8)));
    const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const hash = createHash("sha256").update(secret).digest("hex");
    await this.sql(`INSERT INTO agents(id,name,app,token_hash,created_at) VALUES (${quote(id)},'Claude','claude',${quote(hash)},${quote(new Date().toISOString())});`);
    return { id, token: `lore_agent_${id}_${secret}` };
  }

  async collect(agent: string): Promise<Item[]> {
    const [items] = await this.sql(
      `SELECT id, agent, state, sealed, saved_at FROM inbox WHERE agent = ${quote(agent)} AND state IN ('waiting','forgotten') AND sealed IS NOT NULL ORDER BY saved_at LIMIT 200;`
    );
    return items as Item[];
  }
}

async function connect(url: string, token?: string): Promise<Client> {
  const client = new Client({ name: "lore-hosted-test", version: "0.1.0" });
  const requestInit = token ? { headers: { Authorization: `Bearer ${token}` } } : undefined;
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: hostedFetch, requestInit }));
  return client;
}

describe("statements", () => {
  it("cuts a script at each ; outside quotes and comments", () => {
    expect(statements("SELECT 1; SELECT 'a;b'; SELECT \"x;y\";")).toEqual(["SELECT 1", "SELECT 'a;b'", 'SELECT "x;y"']);
    expect(statements("SELECT 'it''s; fine'; SELECT 2")).toEqual(["SELECT 'it''s; fine'", "SELECT 2"]);
    expect(statements("-- a; comment\nSELECT 1; /* b; */ SELECT 2;\n\n;")).toEqual(["-- a; comment\nSELECT 1", "/* b; */ SELECT 2"]);
    expect(statements("SELECT [a;b] FROM t; SELECT `c;d` FROM t")).toEqual(["SELECT [a;b] FROM t", "SELECT `c;d` FROM t"]);
    expect(() => statements("SELECT 'open")).toThrow(/unterminated/);
  });
});

describe("the owner's signature", () => {
  it("is the one the contract's vector gives, from lore/hosted.py's message", async () => {
    const url = new URL(`https://${vector.host}${vector.path}`);
    const message = await signed(vector.method, url, vector.time, vector.nonce, new TextEncoder().encode(vector.body).buffer);
    expect(new TextDecoder().decode(message)).toBe(vector.message);
    const key = await crypto.subtle.importKey("raw", fromB64url(vector.public_key), { name: "Ed25519" }, false, ["verify"]);
    expect(await crypto.subtle.verify({ name: "Ed25519" }, key, fromB64url(vector.signature), message)).toBe(true);
  });
});

describe("claiming a store", () => {
  it("answers nothing, and keeps nothing, for a store nobody claimed", async () => {
    const store = newStore();
    for (const path of ["/agent", "/.well-known/oauth-authorization-server", "/authorize", "/"]) {
      const response = await hostedFetch(`https://${store}.yourlore.test${path}`);
      expect(response.status).toBe(404);
      await response.text();
    }
    const stub = hosted.STORES.get(hosted.STORES.idFromName(store));
    const tables = await runInDurableObject(stub, (_: HostedStore, state: DurableObjectState) =>
      state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'").toArray()
    );
    expect(tables).toEqual([]);
  });

  it("hands every address that isn't a store on to the Worker behind it", async () => {
    const origin = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => Response.json({ origin: new Request(input).url }));
    try {
      for (const host of ["yourlore.test", "relay.yourlore.test", "abcdefghijk1.yourlore.test", "abcdefghijklm.yourlore.test", `${newStore()}.example.com`]) {
        const response = await hostedFetch(`https://${host}/events`, { method: "POST", body: "{}" });
        expect(await response.json()).toEqual({ origin: `https://${host}/events` });
      }
    } finally {
      origin.mockRestore();
    }
  });

  it("belongs to the first key that signs a claim; the same key may claim again, and no other", async () => {
    const mac = await Mac.claimed();
    expect((await mac.claim()).status).toBe(200);
    const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]));
    const otherKey = b64url(new Uint8Array((await crypto.subtle.exportKey("raw", other.publicKey))));
    const taken = await mac.claim({ key: otherKey, signWith: other.privateKey });
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "this store belongs to someone else" });
  });

  it("takes a claim only when it is signed by the key it names", async () => {
    const mac = await Mac.claimed();
    const fresh = newStore();
    const thief = await hostedFetch(await mac.signedRequest("/claim", JSON.stringify({ key: b64url(new Uint8Array(32).fill(1)) }), { to: `https://${fresh}.yourlore.test` }));
    expect(thief.status).toBe(401);
    await thief.text();
    const unsigned = await hostedFetch(`https://${fresh}.yourlore.test/claim`, { method: "POST", body: JSON.stringify({ key: await mac.publicKey() }) });
    expect(unsigned.status).toBe(401);
    await unsigned.text();
    const garbled = await hostedFetch(`https://${fresh}.yourlore.test/claim`, { method: "POST", body: "not json" });
    expect(garbled.status).toBe(400);
    await garbled.text();
  });
});

describe("the owner's signed requests", () => {
  it("runs the owner's statements and gives back each one's rows", async () => {
    const mac = await Mac.claimed();
    const results = await mac.sql("SELECT 1 AS one; SELECT key FROM node_settings ORDER BY key;");
    expect(results).toEqual([[{ one: 1 }], [{ key: "inbox_public_key" }, { key: "inbox_salt" }]]);
  });

  it("runs them all or none", async () => {
    const mac = await Mac.claimed();
    await expect(mac.sql("INSERT INTO node_settings(key,value) VALUES ('kept','no'); SELECT * FROM no_such_table;")).rejects.toThrow(/no such table/);
    expect((await mac.sql("SELECT count(*) AS n FROM node_settings WHERE key = 'kept';"))[0]).toEqual([{ n: 0 }]);
  });

  it("refuses a request with no signature, another key's, a stale one, one for another store, or one sent twice", async () => {
    const mac = await Mac.claimed();
    const other = await Mac.claimed();
    const body = JSON.stringify({ sql: "SELECT 1;" });
    const replayed = await mac.signedRequest("/owner/sql", body);
    const first = new Request(replayed.url, { method: "POST", headers: replayed.headers, body });
    expect((await hostedFetch(first)).status).toBe(200);
    const refused = [
      new Request(`${mac.origin}/owner/sql`, { method: "POST", body }),
      await mac.signedRequest("/owner/sql", body, { key: other.signing.privateKey }),
      await mac.signedRequest("/owner/sql", body, { time: Date.now() - 301_000 }),
      await mac.signedRequest("/owner/sql", body, { time: Date.now() + 301_000 }),
      await mac.signedRequest("/owner/sql", body, { signFor: other.origin }),
      replayed
    ];
    for (const request of refused) {
      const response = await hostedFetch(request);
      expect(response.status).toBe(401);
      await response.text();
    }
  });

  it("refuses a body over a megabyte", async () => {
    const mac = await Mac.claimed();
    const response = await hostedFetch(await mac.signedRequest("/owner/sql", JSON.stringify({ sql: `SELECT '${"x".repeat(1_048_576)}';` })));
    expect(response.status).toBe(413);
    await response.text();
  });
});

describe("an agent saving to a hosted store", () => {
  it("saves sealed, and only the owner's Mac opens it", async () => {
    const mac = await Mac.claimed();
    const { id, token } = await mac.mint();
    const client = await connect(`${mac.origin}/agent`, token);
    const saved = await client.callTool({ name: "store", arguments: { items: [memory({ key: "pricing" })] } });
    expect(saved.isError).toBeFalsy();
    await client.close();
    const [item] = await mac.collect(id);
    expect(item.sealed).not.toContain("budget tier");
    expect(await open(mac.sealing.privateKey, mac.sealing.publicKey, item.id, item.sealed)).toMatchObject({ key: "pricing", content: memory().content });
  });

  it("takes the key in the address too, for connectors that take only a URL", async () => {
    const mac = await Mac.claimed();
    const { token } = await mac.mint();
    const client = await connect(`${mac.origin}/agent/${token}`);
    expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual(["forget", "store", "stored"]);
    await client.close();
  });

  it("keeps each store's agents to their own store", async () => {
    const mine = await Mac.claimed();
    const theirs = await Mac.claimed();
    const { token } = await mine.mint();
    const response = await hostedFetch(`${theirs.origin}/agent`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(`resource_metadata="${theirs.origin}/.well-known/oauth-protected-resource/agent"`);
    await response.text();
  });

  it("sends plain http to https, where its address is signed for", async () => {
    const mac = await Mac.claimed();
    const response = await hostedFetch(`http://${mac.store}.yourlore.test/agent`, { method: "POST", body: "{}", redirect: "manual" });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`${mac.origin}/agent`);
  });

  it("is never cached", async () => {
    const mac = await Mac.claimed();
    const response = await hostedFetch(`${mac.origin}/.well-known/oauth-protected-resource/agent`);
    expect(response.headers.get("cache-control")).toBeTruthy();
    expect(await response.json()).toMatchObject({ resource: `${mac.origin}/agent`, authorization_servers: [mac.origin] });
  });
});

describe("an agent signing in to a hosted store", () => {
  it("signs in with the owner's yes on the Mac, and saves with its token", async () => {
    const mac = await Mac.claimed();
    const registered = await hostedFetch(`${mac.origin}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] })
    });
    expect(registered.status).toBe(201);
    const { client_id } = await registered.json<{ client_id: string }>();
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const query = new URLSearchParams({ response_type: "code", client_id, redirect_uri: REDIRECT, state: "st4te", code_challenge: challenge, code_challenge_method: "S256", resource: `${mac.origin}/agent`, scope: "save" });
    const page = await hostedFetch(`${mac.origin}/authorize?${query}`);
    const html = await page.text();
    const cookie = (page.headers.get("set-cookie") ?? "").split(";")[0];
    const handle = html.match(/data-handle="([^"]+)"/)?.[1] ?? "";

    // What Allow on the Mac sends (lore/inbox.py `mint` with a sign-in).
    const [[asked]] = await mac.sql("SELECT id FROM sign_ins WHERE state = 'pending';");
    const agent = hex(crypto.getRandomValues(new Uint8Array(8)));
    const hash = createHash("sha256").update(b64url(crypto.getRandomValues(new Uint8Array(32)))).digest("hex");
    const now = quote(new Date().toISOString());
    const waiting = `WHERE id = ${quote(String(asked.id))} AND state = 'pending' AND expires_at > ${now}`;
    await mac.sql(
      `INSERT INTO agents(id,name,app,token_hash,created_at) SELECT ${quote(agent)},'Claude','claude',${quote(hash)},${now} WHERE EXISTS (SELECT 1 FROM sign_ins ${waiting});\n` +
        `UPDATE sign_ins SET state = 'allowed', agent = ${quote(agent)} ${waiting};`
    );

    const form = new FormData();
    form.set("handle", handle);
    const done = await (await hostedFetch(`${mac.origin}/authorize/wait`, { method: "POST", body: form, headers: { cookie } })).json<{ state: string; redirect: string }>();
    expect(done.state).toBe("allowed");
    const code = new URL(done.redirect).searchParams.get("code") ?? "";
    const tokens = await (
      await hostedFetch(`${mac.origin}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id, code_verifier: verifier })
      })
    ).json<{ access_token: string }>();
    const client = await connect(`${mac.origin}/agent`, tokens.access_token);
    expect((await client.callTool({ name: "store", arguments: { items: [memory()] } })).isError).toBeFalsy();
    await client.close();
    expect(await mac.collect(agent)).toHaveLength(1);

    // The grant lives in this store alone: another store doesn't know the token.
    const other = await Mac.claimed();
    const elsewhere = await hostedFetch(`${other.origin}/agent`, { method: "POST", headers: { authorization: `Bearer ${tokens.access_token}`, "content-type": "application/json" }, body: "{}" });
    expect(elsewhere.status).toBe(401);
    await elsewhere.text();
  });
});

describe("the sign-in key store", () => {
  it("expires, lists by prefix a page at a time, and keeps metadata", async () => {
    const mac = await Mac.claimed();
    const stub = hosted.STORES.get(hosted.STORES.idFromName(mac.store));
    await runInDurableObject(stub, async (_: HostedStore, state: DurableObjectState) => {
      const kv = new SqlKv(state.storage.sql);
      await kv.put("grant:a:1", JSON.stringify({ n: 1 }), { metadata: { client: "c" } });
      await kv.put("grant:a:2", "two", { expirationTtl: 60 });
      await kv.put("grant:a:3", "gone", { expiration: Math.floor(Date.now() / 1000) - 1 });
      await kv.put("grant:b:1", "other");
      expect(await kv.get("grant:a:1", { type: "json" })).toEqual({ n: 1 });
      expect(await kv.get("grant:a:2")).toBe("two");
      expect(await kv.get("grant:a:3")).toBeNull();
      const first = await kv.list({ prefix: "grant:a:", limit: 1 });
      expect(first).toEqual({ keys: [{ name: "grant:a:1", metadata: { client: "c" } }], list_complete: false, cursor: "grant:a:1" });
      const second = await kv.list({ prefix: "grant:a:", limit: 1, cursor: first.cursor });
      expect(second.keys.map((key) => key.name)).toEqual(["grant:a:2"]);
      expect(second.keys[0].expiration).toBeGreaterThan(Date.now() / 1000);
      expect(second.list_complete).toBe(true);
      await kv.delete("grant:a:1");
      expect(await kv.get("grant:a:1")).toBeNull();
    });
  });
});

describe("new stores", () => {
  it("are limited per address, so nobody can make stores without end", async () => {
    let limited = false;
    for (let attempt = 0; attempt < 10 && !limited; attempt += 1) {
      const response = await hostedFetch(`https://${newStore()}.yourlore.test/claim`, { method: "POST", body: "{}", headers: { "cf-connecting-ip": "203.0.113.9" } });
      limited = response.status === 429;
      await response.text();
    }
    expect(limited).toBe(true);
  });
});
