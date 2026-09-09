import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureAnswerSchema } from "../src/answer-state";
import { ensureSalesSchema } from "../src/sales";
import { mockFacilitator } from "./facilitator";
import { captureSpans } from "./tracing";

// The owner approved a charter and a price, so D1 says the tier is on. What the
// node lacks is the secret its configured model needs. MON-017: that must be
// discovered before the x402 challenge, not inside the scheduled job after the
// buyer has already paid and no refund path exists.
const PROXY = "Act as Ada's concise, evidence-first proxy with no hedging.";
const ANSWER_PRICE = 0.25;

type Mutable = { ANTHROPIC_API_KEY?: string; LORE_ANSWER_MODEL?: string };
const mutable = env as unknown as Mutable;
const realKey = mutable.ANTHROPIC_API_KEY;

beforeAll(async () => {
  await ensureAnswerSchema(env.LORE_DB);
  // Normally created lazily by init() on first request; the "before" sales
  // count needs it up front.
  await ensureSalesSchema(env.LORE_DB);
  await env.LORE_DB.exec(
    "CREATE TABLE IF NOT EXISTS node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  await env.LORE_DB.batch([
    env.LORE_DB.prepare(
      "INSERT OR REPLACE INTO node_settings(key,value) VALUES ('proxy_preamble', ?1)"
    ).bind(PROXY),
    env.LORE_DB.prepare(
      "INSERT OR REPLACE INTO node_settings(key,value) VALUES ('answer_price_usd', ?1)"
    ).bind(String(ANSWER_PRICE)),
    env.LORE_DB.prepare(
      "INSERT OR REPLACE INTO node_settings(key,value) VALUES ('answer_enabled', 'true')"
    )
  ]);
});

afterAll(() => {
  mutable.ANTHROPIC_API_KEY = realKey;
  delete mutable.LORE_ANSWER_MODEL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh MCP session, and so a fresh agent whose init() re-reads the env. */
async function connect(name: string): Promise<Client> {
  const client = new Client({ name, version: "0.1.0" });
  const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    exports.default.fetch(input, init)) as typeof fetch;
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://worker.test/mcp"), { fetch: workerFetch })
  );
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  return JSON.parse((result.content as { text: string }[])[0].text) as Record<string, unknown>;
}

async function sales(): Promise<number> {
  const row = await env.LORE_DB.prepare("SELECT COUNT(*) AS n FROM sales").first<{ n: number }>();
  return row?.n ?? 0;
}

describe("answer tier enabled but the model provider is not ready", () => {
  it("cannot charge a buyer when the configured model's secret is missing", async () => {
    delete mutable.ANTHROPIC_API_KEY;
    const spans = captureSpans();
    mockFacilitator();
    const before = await sales();
    const client = await connect("lore-answer-unready-test");
    try {
      const catalog = textOf(await client.callTool({ name: "discover", arguments: {} }));
      expect(catalog).not.toHaveProperty("answer_price_usd");
      expect(catalog).not.toHaveProperty("answer_retention_disclosure");

      const blocked = await client.callTool({
        name: "answer",
        arguments: { question: "what would you do here?" }
      });
      expect(blocked.isError).toBe(true);
      // No payment was ever demanded, so nothing could have settled.
      expect(blocked._meta?.["x402/error"]).toBeUndefined();
      expect(await sales()).toBe(before);

      const reason = String(textOf(blocked).error);
      expect(reason).toContain("ANTHROPIC_API_KEY");
      expect(reason).not.toContain("test-key");
      expect(spans.find((s) => s.name === "lore.answer")?.attributes["lore.outcome"]).toBe("unready");
    } finally {
      await client.close();
    }
  });

  it("still resolves a ticket bought while the provider was ready", async () => {
    delete mutable.ANTHROPIC_API_KEY;
    mockFacilitator();
    const now = new Date().toISOString();
    const ticket = "0000000000000000fcdb4b42";
    await env.LORE_DB.prepare(
      "INSERT OR REPLACE INTO answer_jobs(ticket_id,question,price_usd,status,answer,created_at,updated_at) " +
        "VALUES (?1,'question',0.25,'complete','prior answer',?2,?2)"
    )
      .bind(ticket, now)
      .run();
    const client = await connect("lore-answer-unready-result-test");
    try {
      const result = await client.callTool({ name: "result", arguments: { ticket } });
      expect(textOf(result)).toMatchObject({ status: "complete", answer: "prior answer" });
    } finally {
      await client.close();
    }
  });

  it("fails closed on an unsupported model even with every secret present", async () => {
    mutable.ANTHROPIC_API_KEY = realKey ?? "test-key";
    mutable.LORE_ANSWER_MODEL = "gpt-4-turbo";
    mockFacilitator();
    const before = await sales();
    const client = await connect("lore-answer-unsupported-model-test");
    try {
      const catalog = textOf(await client.callTool({ name: "discover", arguments: {} }));
      expect(catalog).not.toHaveProperty("answer_price_usd");

      const blocked = await client.callTool({
        name: "answer",
        arguments: { question: "what would you do here?" }
      });
      expect(blocked.isError).toBe(true);
      expect(blocked._meta?.["x402/error"]).toBeUndefined();
      expect(await sales()).toBe(before);
      expect(String(textOf(blocked).error)).toContain("gpt-4-turbo");
    } finally {
      await client.close();
      delete mutable.LORE_ANSWER_MODEL;
    }
  });
});
