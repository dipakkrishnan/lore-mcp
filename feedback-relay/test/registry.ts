import { vi } from "vitest";

/** Must match the `LORE_GITHUB_API` override in vitest.config.ts. */
export const GITHUB_API = "https://github.test";
export const NODE_HOST = "https://node.test";
export const NODE = `${NODE_HOST}/mcp`;

export interface Seller {
  name: string;
  node: string;
  store: string;
  network: string;
  topics: string[];
  publications: number;
  price_usd: number;
  answer_price_usd?: number;
  listed: string;
}

export interface Pull {
  number: number;
  html_url: string;
  body: string;
  head: { ref: string };
  title: string;
}

export interface Registry {
  /** What `main` holds; a test seeds it. */
  sellers: Seller[];
  /** Pull requests the relay opened, newest last. */
  pulls: Pull[];
  /** The file content the last PUT wrote, decoded. */
  written: { sellers: Seller[] } | null;
  /** Every branch created. */
  branches: string[];
  /** MCP calls the stub node received, by method. */
  nodeCalls: string[];
}

export interface NodeReply {
  publication_count: number;
  topics: Record<string, unknown[]>;
  network: string;
  price_usd: number;
  answer_price_usd?: number;
}

const encode = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const decode = (base64: string): string => new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));

/**
 * Stubs both outbound surfaces the listing route touches: the owner's node
 * (three MCP calls, answered as an event stream like the real Worker) and
 * the registry repo on GitHub (contents, refs, pulls). In-memory, per test;
 * restore with `vi.restoreAllMocks()` in `afterEach`. Any other outbound
 * fetch throws, so a wrong host or path fails loudly.
 */
export function mockRegistry(options: { sellers?: Seller[]; pulls?: Pull[]; node?: NodeReply | "down"; github?: "down" } = {}): Registry {
  const registry: Registry = { sellers: options.sellers ?? [], pulls: options.pulls ?? [], written: null, branches: [], nodeCalls: [] };
  const node: NodeReply | "down" = options.node ?? { publication_count: 2, topics: { zebras: [{}], "agent memory": [{}] }, network: "eip155:8453", price_usd: 0.01, answer_price_usd: 0.1 };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === NODE_HOST) {
      if (node === "down") return new Response("nope", { status: 503 });
      const message: { method: string; id?: number } = await request.json();
      registry.nodeCalls.push(message.method);
      if (message.method === "notifications/initialized") return new Response(null, { status: 202 });
      const result = message.method === "initialize" ? { protocolVersion: "2025-06-18" } : { content: [{ type: "text", text: JSON.stringify(node) }] };
      const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n\n`;
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "session-1" } });
    }
    if (url.origin !== new URL(GITHUB_API).origin) throw new Error(`unexpected outbound fetch during test: ${request.method} ${url.toString()}`);
    if (options.github === "down") return Response.json({ message: "Internal Server Error" }, { status: 502 });
    const path = url.pathname.replace("/repos/dipakkrishnan/lore-marketplace", "");
    if (request.method === "GET" && path === "/pulls") return Response.json(registry.pulls);
    if (request.method === "GET" && path === "/contents/marketplace.json") {
      const content = encode(JSON.stringify({ version: 1, name: "lore-marketplace", sellers: registry.sellers }, null, 2) + "\n");
      return Response.json({ content, sha: "file-sha" });
    }
    if (request.method === "GET" && path === "/git/ref/heads/main") return Response.json({ object: { sha: "main-sha" } });
    if (request.method === "POST" && path === "/git/refs") {
      const body: { ref: string } = await request.json();
      registry.branches.push(body.ref);
      return Response.json({ ref: body.ref }, { status: 201 });
    }
    if (request.method === "PUT" && path === "/contents/marketplace.json") {
      const body: { content: string } = await request.json();
      registry.written = JSON.parse(decode(body.content)) as { sellers: Seller[] };
      return Response.json({ content: { sha: "new-sha" } });
    }
    if (request.method === "POST" && path === "/pulls") {
      const body: { title: string; head: string; body: string } = await request.json();
      const pull: Pull = { number: registry.pulls.length + 1, html_url: `https://github.com/dipakkrishnan/lore-marketplace/pull/${String(registry.pulls.length + 1)}`, body: body.body, head: { ref: body.head }, title: body.title };
      registry.pulls.push(pull);
      return Response.json(pull, { status: 201 });
    }
    throw new Error(`unexpected GitHub request during test: ${request.method} ${url.toString()}`);
  });
  return registry;
}

export function listedSeller(overrides: Partial<Seller> = {}): Seller {
  return {
    name: "Ada",
    node: NODE,
    store: `${NODE_HOST}/`,
    network: "eip155:8453",
    topics: ["agent memory", "zebras"],
    publications: 2,
    price_usd: 0.01,
    answer_price_usd: 0.1,
    listed: "2026-09-01",
    ...overrides
  };
}
