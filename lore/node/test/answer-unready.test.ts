import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { answerReadiness, type AnswerEnv } from "../src/answer";
import { ensureAnswerSchema, newTicketId } from "../src/answer-state";
import { FACILITATOR_URL, mockFacilitator } from "./facilitator";

// MON-017: answers are enabled in settings, but the node cannot run one. It must not advertise a price
// or issue a payment challenge, because the buyer would pay for a failure the node already knew about.

const ANSWER_PRICE = 0.25;
const KEY_VALUE = "test-key"; // the ANTHROPIC_API_KEY fixture bound in vitest.config.ts

beforeAll(async () => {
  await ensureAnswerSchema(env.LORE_DB);
  await env.LORE_DB.batch([
    env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES ('proxy_preamble', 'Act as Ada.')"),
    env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES ('answer_price_usd', ?1)").bind(
      String(ANSWER_PRICE)
    ),
    env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES ('answer_enabled', 'true')")
  ]);
});

const bindings = env as unknown as Record<string, string | undefined>;
const original = { ANTHROPIC_API_KEY: bindings.ANTHROPIC_API_KEY, LORE_ANSWER_MODEL: bindings.LORE_ANSWER_MODEL };

afterEach(() => {
  vi.restoreAllMocks();
  for (const [name, value] of Object.entries(original)) bindings[name] = value;
});

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-answer-unready-test", version: "0.1.0" });
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

const paymentCalls = (spy: ReturnType<typeof mockFacilitator>) =>
  spy.mock.calls.filter(([input]) => {
    const url = new URL(new Request(input).url);
    return url.origin === new URL(FACILITATOR_URL).origin && url.pathname !== "/supported";
  });

async function jobCount(): Promise<number> {
  const row = await env.LORE_DB.prepare("SELECT COUNT(*) AS n FROM answer_jobs").first<{ n: number }>();
  return row?.n ?? 0;
}

/** What a buyer sees when it asks for a paid answer on a node that cannot run one. */
async function refusedWith(setup: () => void, mustName: string) {
  setup();
  const spy = mockFacilitator();
  const before = await jobCount();
  const client = await connect();
  try {
    const discover = textOf(await client.callTool({ name: "discover", arguments: {} }));
    expect(discover).not.toHaveProperty("answer_price_usd");
    expect(discover).not.toHaveProperty("answer_retention_disclosure");

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["answer", "discover", "get", "result"]);

    const refused = await client.callTool({ name: "answer", arguments: { question: "anything" } });
    expect(refused.isError).toBe(true);
    // No x402 challenge: there is nothing to pay for.
    expect(refused._meta?.["x402/error"]).toBeUndefined();
    const body = textOf(refused);
    expect(body.code).toBe("answer_unavailable");
    expect(String(body.error)).toContain(mustName);
    expect(JSON.stringify(refused)).not.toContain(KEY_VALUE);

    expect(paymentCalls(spy)).toEqual([]);
    expect(await jobCount()).toBe(before);
  } finally {
    await client.close();
  }
}

describe("answer tier enabled, provider not ready (MON-017)", () => {
  it("does not advertise or charge for answers when the selected provider's key is missing", async () => {
    await refusedWith(() => {
      bindings.ANTHROPIC_API_KEY = undefined;
    }, "ANTHROPIC_API_KEY");
  });

  it("fails closed on an unsupported model before any payment challenge", async () => {
    await refusedWith(() => {
      bindings.LORE_ANSWER_MODEL = "not-a-model";
    }, "unsupported answer model: not-a-model");
  });

  it("keeps free result polling for an existing ticket while the provider is unavailable", async () => {
    bindings.ANTHROPIC_API_KEY = undefined;
    mockFacilitator();
    const ticket = newTicketId();
    const now = new Date().toISOString();
    await env.LORE_DB.prepare(
      "INSERT INTO answer_jobs(ticket_id,question,price_usd,status,answer,created_at,updated_at) " +
        "VALUES (?1,'question',0.25,'complete','paid-for answer',?2,?2)"
    )
      .bind(ticket, now)
      .run();
    const client = await connect();
    try {
      const result = await client.callTool({ name: "result", arguments: { ticket } });
      expect(result.isError).toBeUndefined();
      expect(textOf(result)).toMatchObject({ status: "complete", answer: "paid-for answer" });
    } finally {
      await client.close();
    }
  });
});

describe("answerReadiness", () => {
  const base = (overrides: Partial<AnswerEnv> = {}) => overrides as AnswerEnv;

  it("is ready for the default model with its key, and for the OpenAI model with its key", () => {
    expect(answerReadiness(base({ ANTHROPIC_API_KEY: "secret-a" }))).toEqual({ ready: true });
    expect(answerReadiness(base({ LORE_ANSWER_MODEL: "gpt-5.6-luna", OPENAI_API_KEY: "secret-o" }))).toEqual({
      ready: true
    });
  });

  it("names only the missing binding, and the key of another provider does not count", () => {
    expect(answerReadiness(base())).toEqual({ ready: false, reason: "the node has no ANTHROPIC_API_KEY secret" });
    expect(answerReadiness(base({ OPENAI_API_KEY: "secret-o" }))).toEqual({
      ready: false,
      reason: "the node has no ANTHROPIC_API_KEY secret"
    });
    expect(answerReadiness(base({ LORE_ANSWER_MODEL: "gpt-5.6-luna", ANTHROPIC_API_KEY: "secret-a" }))).toEqual({
      ready: false,
      reason: "the node has no OPENAI_API_KEY secret"
    });
  });

  it("names the unsupported model and never echoes a credential", () => {
    const verdict = answerReadiness(base({ LORE_ANSWER_MODEL: "gpt-4", ANTHROPIC_API_KEY: "secret-a" }));
    expect(verdict).toEqual({ ready: false, reason: "unsupported answer model: gpt-4" });
    expect(JSON.stringify(verdict)).not.toContain("secret-a");
  });
});
