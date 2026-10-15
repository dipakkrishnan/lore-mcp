// XC-013: what the Worker serves before anyone pays, driven through its real
// fetch handler with no deployed node. scripts/smoke.ts makes the same checks
// against a running node; both read the tool list and catalog-entry keys from
// scripts/surface.ts.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import contract from "../../../contracts/mcp_tools.json";
import { TOOL_NAMES, entryKeysProblem } from "../scripts/surface";
import { newTicketId } from "../src/answer-state";
import { PRICE_USD, usdcBaseUnits } from "../src/price";
import { mockFacilitator } from "./facilitator";

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

// Plain ASCII, so JSON escaping can never hide one from a substring check, and
// nothing paid is a substring of the teaser, which is free.
const PIECE = {
  id: newTicketId(),
  title: "XC013-PAID-TITLE",
  content: "XC013-PAID-CONTENT",
  topic: "xc013-paid-topic",
  teaser: "a request-path teaser"
};
const PAID_ONLY = [PIECE.title, PIECE.content];

const WALLET = env.LORE_WALLET;
const setWallet = (wallet: string | undefined) => {
  (env as { LORE_WALLET: string | undefined }).LORE_WALLET = wallet;
};

const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  exports.default.fetch(input, init)) as typeof fetch;

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-request-path-test", version: "0.1.0" });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL("https://worker.test/mcp"), { fetch: workerFetch })
    );
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return client;
}

function textOf(result: CallToolResult): Record<string, unknown> {
  return JSON.parse((result.content as { text: string }[])[0].text) as Record<string, unknown>;
}

function settlementCalls(fetchSpy: ReturnType<typeof mockFacilitator>): string[] {
  return fetchSpy.mock.calls
    .map(([input]) => new URL(input instanceof Request ? input.url : input).pathname)
    .filter((path) => path === "/verify" || path === "/settle");
}

async function salesOf(id: string): Promise<number> {
  // The table exists only once a Durable Object has started.
  const row = await env.LORE_DB.prepare("SELECT COUNT(*) AS n FROM sales WHERE item_id = ?1")
    .bind(id)
    .first<{ n: number }>()
    .catch(() => ({ n: 0 }));
  return row?.n ?? 0;
}

beforeAll(async () => {
  await env.LORE_DB.prepare(
    `INSERT INTO publications (public_id, title, content, kind, topic, teaser, updated_at)
     VALUES (?1, ?2, ?3, 'note', ?4, ?5, '2026-01-03T00:00:00Z')`
  )
    .bind(PIECE.id, PIECE.title, PIECE.content, PIECE.topic, PIECE.teaser)
    .run();
  // A fresh Worker's first answer can run past the per-test timeout; spend
  // that wait here rather than in whichever test happens to run first.
  mockFacilitator();
  await (await connect()).close();
}, 30_000);

afterEach(async () => {
  vi.restoreAllMocks();
  setWallet(WALLET);
  // One test's sale must never be what fails the next.
  await env.LORE_DB.prepare("DELETE FROM sales WHERE item_id = ?1").bind(PIECE.id).run().catch(() => undefined);
});

afterAll(async () => {
  await env.LORE_DB.prepare("DELETE FROM publications WHERE public_id = ?1").bind(PIECE.id).run();
});

describe("before any payment", () => {
  it("lists the tools the contract names, the same list the smoke script checks", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const listed = tools.map(({ name }) => name).sort();
      expect(listed).toEqual([...TOOL_NAMES]);
      const canonical = contract
        .filter((tool) => !("surfaces" in tool) || (tool.surfaces ?? []).includes("worker"))
        .map(({ name }) => name)
        .sort();
      expect([...TOOL_NAMES]).toEqual(canonical);
    } finally {
      await client.close();
    }
  });

  it("serves discover free: the price and the teasers, never what is sold", async () => {
    const fetchSpy = mockFacilitator();
    const client = await connect();
    try {
      const result = await client.callTool({ name: "discover", arguments: {} });
      expect(result.isError).toBeUndefined();
      expect(result._meta?.["x402/error"]).toBeUndefined();
      const payload = textOf(result);
      expect(payload.manifest_version).toBe(1);
      // No owner settings in this suite: the deployed price stands and nothing is given away.
      expect(payload.price_usd).toBe(PRICE_USD);
      expect(payload).not.toHaveProperty("free_copies");
      const topics = payload.topics as Record<string, Record<string, unknown>[]>;
      expect(topics[PIECE.topic]).toEqual([
        { id: PIECE.id, teaser: PIECE.teaser, kind: "note", updated_at: "2026-01-03" }
      ]);
      for (const entry of Object.values(topics).flat()) {
        expect(entryKeysProblem(Object.keys(entry)), JSON.stringify(entry)).toBeNull();
      }
      const served = JSON.stringify(result);
      for (const paid of PAID_ONLY) expect(served).not.toContain(paid);
      expect(settlementCalls(fetchSpy)).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it("answers an unpaid get with a 402 challenge that carries payment terms and nothing of the piece", async () => {
    const fetchSpy = mockFacilitator();
    const client = await connect();
    try {
      const discovered = textOf(await client.callTool({ name: "discover", arguments: {} }));
      const result = await client.callTool({ name: "get", arguments: { id: PIECE.id } });
      expect(result.isError).toBe(true);
      const challenge = result._meta?.["x402/error"] as {
        x402Version: number;
        error: string;
        accepts: Record<string, unknown>[];
      };
      expect(challenge.x402Version).toBe(2);
      expect(challenge.error).toBe("PAYMENT_REQUIRED");
      expect(challenge.accepts).toHaveLength(1);
      expect(challenge.accepts[0]).toMatchObject({
        scheme: "exact",
        network: discovered.network,
        payTo: WALLET,
        amount: usdcBaseUnits(PRICE_USD).toString()
      });
      const served = JSON.stringify(result);
      for (const paid of [...PAID_ONLY, PIECE.topic]) expect(served).not.toContain(paid);
      expect(settlementCalls(fetchSpy)).toEqual([]);
      expect(await salesOf(PIECE.id)).toBe(0);
    } finally {
      await client.close();
    }
  });

  it("rejects a damaged id before asking for payment", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const result = await client.callTool({ name: "get", arguments: { id: "000000000000000000000000" } });
      expect(result.isError).toBe(true);
      expect(result._meta?.["x402/error"]).toBeUndefined();
    } finally {
      await client.close();
    }
  });
});

describe("the catalog-entry check the smoke script shares", () => {
  const required = ["id", "kind", "teaser", "updated_at"];

  it("accepts an entry with or without the lines an owner may add", () => {
    expect(entryKeysProblem(required)).toBeNull();
    expect(entryKeysProblem([...required, "sample", "useful_if", "not_useful_if"])).toBeNull();
  });

  it("names a missing key, and any key that would put the piece itself in the catalog", () => {
    expect(entryKeysProblem(["id", "kind", "teaser"])).toBe("missing updated_at");
    expect(entryKeysProblem([...required, "title", "content"])).toBe("unexpected title, content");
  });
});

describe("without a usable LORE_WALLET", () => {
  const initialize = () =>
    workerFetch("https://worker.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "lore-request-path-test", version: "0.1.0" }
        }
      })
    });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not an address", "not an address"],
    ["a private key", `0x${"1".repeat(64)}`]
  ])("the MCP surface refuses to start when it is %s", async (_label, wallet) => {
    mockFacilitator();
    // The same request succeeds with the wallet in place, so the refusals
    // below are the wallet's doing and not a broken harness.
    const before = await initialize();
    expect(before.status).toBe(200);
    await before.body?.cancel();

    setWallet(wallet);
    await expect(initialize()).rejects.toThrow(/public EVM address/);
    await expect(connect()).rejects.toThrow(/public EVM address/);

    setWallet(WALLET);
    const client = await connect();
    try {
      expect((await client.listTools()).tools).toHaveLength(TOOL_NAMES.length);
    } finally {
      await client.close();
    }
  });

  it("the store pages still show only what is free", async () => {
    mockFacilitator();
    setWallet(undefined);
    // These routes never build the MCP server, so they answer without a
    // wallet. What they may say is the teaser; the piece itself stays unsold.
    const routes: [string, RequestInit?][] = [
      ["/"],
      [`/p/${PIECE.id}`],
      [`/p/${PIECE.id}.json`],
      [`/p/${PIECE.id}/free`, { method: "POST" }]
    ];
    for (const [path, init] of routes) {
      const body = await (await workerFetch(`https://worker.test${path}`, init)).text();
      expect(body, path).toContain(PIECE.teaser);
      for (const paid of PAID_ONLY) expect(body, path).not.toContain(paid);
    }
    expect(await salesOf(PIECE.id)).toBe(0);
  });
});
