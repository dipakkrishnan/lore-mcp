// The buyer's side of the Worker, through its real fetch handler: the MCP surface before anyone pays
// (XC-013), the paid `get` against a stubbed facilitator with no network, wallet, or faucet funds
// (MON-010), the tool contract shared with the Python surface (MCP-002), the answer tier off by
// default, and the store pages a person or a browsing agent sees.
// XC-101: these were six files, each paying a Worker cold start; they share this one's.
import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/core/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
// Bundled at transform time, not read from disk at run time — the workerd
// sandbox this suite runs in (`@cloudflare/vitest-pool-workers`) has no
// access to the host filesystem.
import contract from "../../../contracts/mcp_tools.json";
import { TOOL_NAMES, entryKeysProblem } from "../scripts/surface";
import { manifest, newTicketId } from "../src/answer-state";
import { PRICE_USD, usdcBaseUnits } from "../src/price";
import { mockFacilitator } from "./facilitator";
import { FIXTURE_PUBLICATION_ID } from "./setup";
import { captureSpans } from "./tracing";

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type PaymentRequired = Parameters<x402Client["createPaymentPayload"]>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  exports.default.fetch(input, init)) as typeof fetch;

/** A page as a person's browser asks for it. */
const visit = (path: string, method = "GET") => exports.default.fetch(new Request(`https://worker.test${path}`, { method }));

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-canary-test", version: "0.1.0" });
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
  const text = (result.content as { text: string }[])[0].text;
  const payload: unknown = JSON.parse(text);
  if (!isRecord(payload)) throw new Error("tool returned a non-object payload");
  return payload;
}

function x402ErrorOf(result: CallToolResult): PaymentRequired {
  const error = result._meta?.["x402/error"];
  expect(error).toBeTruthy();
  return error as PaymentRequired;
}

// Builds a real, locally-signed x402 payment payload from a `get` challenge's
// `accepts` array — the same client machinery scripts/pay.ts uses against a
// live deployment, but signed by a throwaway key that never touches a chain.
async function buildPaymentToken(x402Error: PaymentRequired): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  const paymentClient = new x402Client();
  registerExactEvmScheme(paymentClient, { signer: toClientEvmSigner(account) });
  const paymentPayload = await paymentClient.createPaymentPayload(x402Error);
  return btoa(JSON.stringify(paymentPayload));
}

// Calls the unpaid `get` challenge and turns its `accepts` array into a
// spendable token, exactly as a real buyer's client would after seeing 402.
async function challengeAndBuildToken(client: Client, id = FIXTURE_PUBLICATION_ID): Promise<string> {
  const challenge = await client.callTool({ name: "get", arguments: { id } });
  expect(challenge.isError).toBe(true);
  return buildPaymentToken(x402ErrorOf(challenge));
}

afterEach(async () => {
  vi.restoreAllMocks();
  await env.LORE_DB.prepare("DELETE FROM sales").run();
});

describe("discover", () => {
  it("advertises teasers and topics only — content never reaches the free surface", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const result = await client.callTool({ name: "discover", arguments: {} });
      expect(result.isError).toBeUndefined();
      const payload = textOf(result);
      expect(payload.payout).toBe(env.LORE_WALLET);
      expect(payload.listed).toBe(false);
      expect(payload).not.toHaveProperty("name");
      const entries = Object.values(payload.topics as Record<string, object[]>).flat();
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(["id", "kind", "not_useful_if", "sample", "teaser", "updated_at", "useful_if", "words"]).toEqual(expect.arrayContaining(Object.keys(entry)));
      }
      expect(JSON.stringify(payload)).not.toContain("owner-approved content");
    } finally {
      await client.close();
    }
  });

  it("records a span carrying only the tool name and an ok outcome — never the catalog", async () => {
    const spans = captureSpans();
    mockFacilitator();
    const client = await connect();
    try {
      await client.callTool({ name: "discover", arguments: {} });
      const span = spans.find((s) => s.name === "lore.discover");
      expect(span?.attributes).toEqual({ "lore.tool": "discover", "lore.outcome": "ok" });
    } finally {
      await client.close();
    }
  });
});

async function sales() {
  const { results } = await env.LORE_DB.prepare("SELECT * FROM sales").all();
  return results;
}

describe("get (paid)", () => {
  it.each([undefined, "start", "attributes", "end"] as const)("returns paid content and records one sale with tracing failure %s", async (failure) => {
    if (failure) captureSpans(failure);
    mockFacilitator();
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const paid = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(paid.isError).toBeUndefined();
      const publication = textOf(paid).publication as { content: string };
      expect(publication.content).toContain("secret owner-approved content");
      expect(await sales()).toMatchObject([
        {
          kind: "publication",
          item_id: FIXTURE_PUBLICATION_ID,
          title: "Fixture Publication",
          price_usd: 0.01,
          network: "eip155:84532",
          payer: "0xfixturepayer",
          tx: "0xfixturetransaction"
        }
      ]);
    } finally {
      await client.close();
    }
  });

  it("records an ok outcome with a hashed id on the get span, and settled on the sale span — never the title, payer, or transaction hash", async () => {
    const spans = captureSpans();
    mockFacilitator();
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const paid = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(paid.isError).toBeUndefined();

      const getSpan = spans.find((s) => s.name === "lore.get");
      expect(getSpan?.attributes["lore.outcome"]).toBe("ok");
      expect(getSpan?.attributes["lore.item_hash"]).toBeTypeOf("string");
      expect(getSpan?.attributes["lore.item_hash"]).not.toBe(FIXTURE_PUBLICATION_ID);

      const saleSpan = spans.find((s) => s.name === "lore.sale");
      expect(saleSpan?.attributes).toEqual({ "lore.settled": true, "lore.outcome": "ok" });

      const serialized = JSON.stringify(spans);
      expect(serialized).not.toContain(FIXTURE_PUBLICATION_ID);
      expect(serialized).not.toContain("Fixture Publication");
      expect(serialized).not.toContain("secret owner-approved content");
      expect(serialized).not.toContain("0xfixturepayer");
      expect(serialized).not.toContain("0xfixturetransaction");
    } finally {
      await client.close();
    }
  });

  it("records a not_found outcome and a hashed id when the id is well-formed but unknown", async () => {
    const spans = captureSpans();
    mockFacilitator();
    const client = await connect();
    try {
      const unknownId = newTicketId();
      const token = await challengeAndBuildToken(client, unknownId);
      const result = await client.callTool({
        name: "get",
        arguments: { id: unknownId },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      const span = spans.find((s) => s.name === "lore.get");
      expect(span?.attributes["lore.outcome"]).toBe("not_found");
      expect(span?.attributes["lore.item_hash"]).toBeTypeOf("string");
      expect(JSON.stringify(spans)).not.toContain(unknownId);
    } finally {
      await client.close();
    }
  });

  it("never settles a get for a piece that isn't for sale, such as one revoked after discover or one with no free sample", async () => {
    for (const revokedId of [newTicketId(), "1111111111111111807ae5f3"]) await neverSold(revokedId);
  });

  async function neverSold(revokedId: string) {
    const fetchSpy = mockFacilitator();
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client, revokedId);
      const result = await client.callTool({ name: "get", arguments: { id: revokedId }, _meta: { "x402/payment": token } });
      expect(result.isError).toBe(true);
      expect(result._meta?.["x402/payment-response"]).toBeUndefined();
      const settleCalls = fetchSpy.mock.calls.filter(
        ([input]) => new URL(input instanceof Request ? input.url : input).pathname === "/settle"
      );
      expect(settleCalls).toHaveLength(0);
      const sold = await env.LORE_DB.prepare("SELECT COUNT(*) AS n FROM sales WHERE item_id = ?1").bind(revokedId).first<{ n: number }>();
      expect(sold?.n).toBe(0);
    } finally {
      await client.close();
      vi.restoreAllMocks();
    }
  }

  it("fails closed on an invalid credential: no content, settlement never attempted", async () => {
    const fetchSpy = mockFacilitator({ verify: { kind: "rejected", reason: "INVALID_SIGNATURE" } });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const result = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      expect(result._meta?.["x402/error"]).toBeTruthy();
      expect(JSON.stringify(result)).not.toContain("secret owner-approved content");
      const settleCalls = fetchSpy.mock.calls.filter(([input]) => {
        const url = input instanceof Request ? input.url : input;
        return new URL(url).pathname === "/settle";
      });
      expect(settleCalls).toHaveLength(0);
    } finally {
      await client.close();
    }
  });

  it("fails closed on a replayed credential: the second use of the same token is rejected", async () => {
    mockFacilitator({ verify: [{ kind: "ok" }, { kind: "rejected", reason: "replay" }] });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const paid = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(paid.isError).toBeUndefined();

      const replay = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(replay.isError).toBe(true);
      expect(JSON.stringify(replay)).not.toContain("secret owner-approved content");
    } finally {
      await client.close();
    }
  });

  it("fails closed when the facilitator 5xxs during verification", async () => {
    mockFacilitator({ verify: { kind: "http-error", status: 500 } });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const result = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret owner-approved content");
    } finally {
      await client.close();
    }
  });

  it("fails closed when the facilitator times out during verification", async () => {
    mockFacilitator({ verify: { kind: "unreachable" } });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const result = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret owner-approved content");
    } finally {
      await client.close();
    }
  });

  it("still returns the paid-for content when writing the sales row throws, and records ledger_failed", async () => {
    const spans = captureSpans();
    mockFacilitator();
    const client = await connect();
    const realPrepare = env.LORE_DB.prepare.bind(env.LORE_DB);
    const prepareSpy = vi.spyOn(env.LORE_DB, "prepare").mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO sales")) throw new Error("simulated D1 write failure");
      return realPrepare(sql);
    });
    try {
      const token = await challengeAndBuildToken(client);
      const paid = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(paid.isError).toBeUndefined();
      const publication = textOf(paid).publication as { content: string };
      expect(publication.content).toContain("secret owner-approved content");
      const saleSpan = spans.find((s) => s.name === "lore.sale");
      expect(saleSpan?.attributes).toEqual({ "lore.settled": true, "lore.outcome": "ledger_failed" });
    } finally {
      prepareSpy.mockRestore();
      await client.close();
    }
  });

  it("fails closed when settlement fails after a successful verification, and records no sale span", async () => {
    const spans = captureSpans();
    mockFacilitator({ settle: { kind: "http-error", status: 503 } });
    const client = await connect();
    try {
      const token = await challengeAndBuildToken(client);
      const result = await client.callTool({
        name: "get",
        arguments: { id: FIXTURE_PUBLICATION_ID },
        _meta: { "x402/payment": token }
      });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("secret owner-approved content");
      expect(await sales()).toEqual([]);
      expect(spans.find((s) => s.name === "lore.sale")).toBeUndefined();
    } finally {
      await client.close();
    }
  });
});

// XC-013: what the Worker serves before anyone pays. scripts/smoke.ts makes the same checks
// against a running node; both read the tool list and catalog-entry keys from scripts/surface.ts.
describe("before anyone pays", () => {
  // Plain ASCII, so JSON escaping can never hide one from a substring check, and
  // nothing paid is a substring of the teaser, which is free.
  const PIECE = {
    id: newTicketId(),
    title: "XC013-PAID-TITLE",
    content: "XC013-PAID-CONTENT",
    topic: "xc013-paid-topic",
    teaser: "a request-path teaser",
    sample: "A request-path sample. It is free to read."
  };
  const PAID_ONLY = [PIECE.title, PIECE.content];

  const WALLET = env.LORE_WALLET;
  const setWallet = (wallet: string | undefined) => {
    (env as { LORE_WALLET: string | undefined }).LORE_WALLET = wallet;
  };

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
      `INSERT INTO publications (public_id, title, content, kind, topic, teaser, sample, updated_at)
       VALUES (?1, ?2, ?3, 'note', ?4, ?5, ?6, '2026-01-03T00:00:00Z')`
    )
      .bind(PIECE.id, PIECE.title, PIECE.content, PIECE.topic, PIECE.teaser, PIECE.sample)
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
        expect(topics["Xc013-paid-topic"]).toEqual([
          { id: PIECE.id, teaser: PIECE.teaser, kind: "note", updated_at: "2026-01-03", sample: PIECE.sample, words: 1 }
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

    // A missing or empty one is a store with nothing for sale yet (XC-069, test/empty-store.test.ts);
    // one that is set to something other than an address is a mistake, and the store refuses to start.
    it.each([
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

    it("the store pages never show the piece itself", async () => {
      mockFacilitator();
      setWallet("not an address");
      // These routes never build the MCP server, so they answer with a broken
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

  // MCP-002: the Worker's registered tools must match the cross-surface
  // contract shared with the Python stdio server (lore/mcp.py). See
  // tests/test_mcp_contract.py for the Python-side half of this check — each
  // surface verifies itself against the same checked-in contracts/mcp_tools.json,
  // so either one drifting from it fails on its own side.
  //
  // Entries may scope themselves to one surface (the answer tier is
  // worker-only); an entry without `surfaces` is shared by both.
  const canonical = contract
    .filter((tool) => !("surfaces" in tool) || (tool.surfaces ?? []).includes("worker"))
    .map(({ name, description, required }) => ({ name, description, required }));

  describe("MCP tool contract", () => {
    it(
      "matches the contract shared with the Python stdio surface",
      async () => {
        const client = await connect();
        try {
          const { tools } = await client.listTools();
          const actual = tools
            .map((tool) => ({
              name: tool.name,
              description: tool.description,
              required: [...((tool.inputSchema.required as string[]) ?? [])].sort()
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          expect(actual).toEqual(canonical);
        } finally {
          await client.close();
        }
      },
      // A fresh Worker cold start under this pool can run past vitest's
      // default 5s, especially alongside sibling test files' own Workers.
      20_000
    );
  });
});

describe("answer tier disabled (the default)", () => {
  it("blocks new answers without hiding prior results", async () => {
    const spans = captureSpans();
    mockFacilitator();
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["answer", "discover", "get", "result"]);

      const blocked = await client.callTool({
        name: "answer",
        arguments: { question: "anything" }
      });
      expect(blocked.isError).toBe(true);
      expect(blocked._meta?.["x402/error"]).toBeUndefined();
      expect(spans.find((s) => s.name === "lore.answer")?.attributes["lore.outcome"]).toBe("disabled");

      const now = new Date().toISOString();
      const ticket = "0000000000000000fcdb4b42";
      await env.LORE_DB.prepare(
        "INSERT INTO answer_jobs(ticket_id,question,price_usd,status,answer,created_at,updated_at) " +
          "VALUES (?1,'question',0.25,'complete','prior answer',?2,?2)"
      )
        .bind(ticket, now)
        .run();
      const result = await client.callTool({ name: "result", arguments: { ticket } });
      expect(textOf(result)).toMatchObject({ status: "complete", answer: "prior answer" });
      const resultSpan = spans.find((s) => s.name === "lore.result");
      expect(resultSpan?.attributes["lore.outcome"]).toBe("ok");
      expect(JSON.stringify(spans)).not.toContain("prior answer");
    } finally {
      await client.close();
    }
  });
});

// Page views come before the pages' own tests: a view is counted after the response, so a page
// opened just before this would land in its count.
const views = async () =>
  (await env.LORE_DB.prepare("SELECT views FROM page_views WHERE item_id = ?1").bind(FIXTURE_PUBLICATION_ID).first<{ views: number }>().catch(() => null))?.views ?? 0;

describe("page views", () => {
  it("counts a person opening a piece's page, and nothing else", async () => {
    const before = await views();
    await visit(`/p/${FIXTURE_PUBLICATION_ID}`);
    await vi.waitFor(async () => expect(await views()).toBe(before + 1));
    await visit(`/p/${FIXTURE_PUBLICATION_ID}`, "HEAD");
    await visit(`/p/${FIXTURE_PUBLICATION_ID}.json`);
    await visit("/");
    await visit(`/p/${"f".repeat(24)}`);
    await new Promise((settle) => setTimeout(settle, 100));
    expect(await views()).toBe(before + 1);
  });

  it("keeps a count per piece and nothing about who looked", async () => {
    await visit(`/p/${FIXTURE_PUBLICATION_ID}`);
    await vi.waitFor(async () => expect(await views()).toBeGreaterThan(0));
    const { results } = await env.LORE_DB.prepare("PRAGMA table_info(page_views)").all<{ name: string }>();
    expect(results.map((column) => column.name)).toEqual(["item_id", "views"]);
  });
});

describe("store pages", () => {
  it("serves the store and each piece without the title or the text", async () => {
    for (const path of ["/", `/p/${FIXTURE_PUBLICATION_ID}`, `/p/${FIXTURE_PUBLICATION_ID}/`]) {
      const response = await visit(path);
      expect(response.status).toBe(200);
      const html = await response.text();
      expect(html).toContain("a teaser that is safe to advertise");
      expect(html).not.toContain("Fixture Publication");
      expect(html).not.toContain("the secret owner-approved content");
    }
  });

  it("shows the owner's free sample on the piece page, never the paid text", async () => {
    const html = await (await visit(`/p/${FIXTURE_PUBLICATION_ID}`)).text();
    expect(html).toContain("a free sample the owner approved");
    expect(html).toContain("Useful if you are testing the free surface");
    expect(html).not.toContain("the secret owner-approved content");
  });

  it("doesn't offer a piece that has no free sample, on the store, on its page, or to checkout (MON-052)", async () => {
    const unsampled = "1111111111111111807ae5f3";
    const store = await (await visit("/")).text();
    expect(store).toContain("a teaser that is safe to advertise");
    expect(store).not.toContain("a second teaser");
    expect(store).not.toContain(`/p/${unsampled}`);
    for (const path of [`/p/${unsampled}`, `/p/${unsampled}.json`]) expect((await visit(path)).status).toBe(404);
  });

  it("heads a piece with its topic's public name, on the store and in discover's catalog (MON-052)", async () => {
    const id = newTicketId();
    await env.LORE_DB.prepare(
      `INSERT INTO publications (public_id, title, content, kind, topic, teaser, sample, updated_at)
       VALUES (?1, 'Seats', 'Pick the left side.', 'claim', 'travel: window seat on United', 'Which seat?', 'I fly a lot. Seats matter.', '2026-01-04')`
    )
      .bind(id)
      .run();
    try {
      const store = await (await visit("/")).text();
      expect(store).toContain("<h2>Travel <small>1</small></h2>");
      expect(store).not.toContain("window seat");
      expect(Object.keys((await manifest(env)).topics)).toContain("Travel");
    } finally {
      await env.LORE_DB.prepare("DELETE FROM publications WHERE public_id = ?1").bind(id).run();
    }
  });

  it("answers HEAD with headers only", async () => {
    const response = await visit(`/p/${FIXTURE_PUBLICATION_ID}`, "HEAD");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("");
  });

  it("returns the store's own 404 page for anything under /p that isn't for sale", async () => {
    for (const path of [`/p/${"f".repeat(24)}`, "/p/abc", `/p/${FIXTURE_PUBLICATION_ID.toUpperCase()}`, "/p"]) {
      const response = await visit(path);
      expect(response.status).toBe(404);
      expect(await response.text()).toContain("Not for sale here.");
    }
  });
});

describe("edge caching", () => {
  it("marks store pages public and everything else no-store", async () => {
    expect((await visit("/")).headers.get("cache-control")).toBe("public, max-age=60");
    for (const path of ["/mcp", "/elsewhere"]) {
      expect((await visit(path)).headers.get("cache-control")).toMatch(/no-store|no-cache/);
    }
  });
});
