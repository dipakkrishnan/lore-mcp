import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { sealingKey } from "../src/seal";
import { b64url, fromB64url } from "../src/token";

export const BASE = "https://inbox.test";

export const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) => exports.default.fetch(input, init)) as typeof fetch;

export function call(path: string, token?: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<Response> {
  return workerFetch(`${BASE}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });
}

export function stub(owner: string) {
  return env.INBOX.get(env.INBOX.idFromName(owner));
}

/** The owner's X25519 key, as the Mac would hold it. */
export async function ownerKey(): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer> }> {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  return { privateKey: pair.privateKey, publicKey: new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer) };
}

/** The owner side of contracts/inbox.md "Sealing". */
export async function open(privateKey: CryptoKey, ownerPublic: Uint8Array<ArrayBuffer>, itemId: string, sealed: string): Promise<unknown> {
  const bytes = fromB64url(sealed);
  const eph = bytes.slice(0, 32);
  const key = await sealingKey(privateKey, eph, new Uint8Array([...eph, ...ownerPublic]));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(32, 44), additionalData: new TextEncoder().encode(itemId) }, key, bytes.slice(44));
  return JSON.parse(new TextDecoder().decode(plain));
}

export class Owner {
  constructor(
    readonly id: string,
    readonly token: string,
    readonly key: { privateKey: CryptoKey; publicKey: Uint8Array<ArrayBuffer> }
  ) {}

  static async register(): Promise<Owner> {
    const key = await ownerKey();
    const response = await call("/owners", undefined, {
      body: { public_key: b64url(key.publicKey) },
      headers: { "cf-connecting-ip": `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}` }
    });
    if (response.status !== 201) throw new Error(`register: ${response.status}`);
    const { owner, token } = await response.json<{ owner: string; token: string }>();
    return new Owner(owner, token, key);
  }

  call(path: string, init: Parameters<typeof call>[2] = {}): Promise<Response> {
    return call(`/owners/me${path}`, this.token, init);
  }

  async agent(name = "Grok", app = "grok"): Promise<{ id: string; token: string }> {
    const response = await this.call("/agents", { body: { name, app } });
    const { agent, token } = await response.json<{ agent: { id: string }; token: string }>();
    return { id: agent.id, token };
  }

  async items(query = ""): Promise<{ id: string; agent: string; state: string; sealed: string; saved_at: string }[]> {
    const response = await this.call(`/items${query}`);
    return (await response.json<{ items: [] }>()).items;
  }

  async opened(): Promise<{ id: string; state: string; plain: Record<string, unknown> }[]> {
    return Promise.all(
      (await this.items()).map(async (item) => ({
        id: item.id,
        state: item.state,
        plain: (await open(this.key.privateKey, this.key.publicKey, item.id, item.sealed)) as Record<string, unknown>
      }))
    );
  }
}

export class Agent {
  private constructor(readonly client: Client) {}

  static async connect(token: string): Promise<Agent> {
    const client = new Client({ name: "lore-inbox-test", version: "0.1.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { fetch: workerFetch, requestInit: { headers: { Authorization: `Bearer ${token}` } } })
    );
    return new Agent(client);
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
