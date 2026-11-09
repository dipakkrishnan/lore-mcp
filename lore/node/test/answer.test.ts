// The paid answer tier end to end, and (MON-017) a node with answers enabled that cannot run one.
// XC-101 folded the second in here to share this file's Worker cold start.
import { toClientEvmSigner } from "@x402/evm";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/core/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { abortAllDurableObjects, runInDurableObject } from "cloudflare:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { answerReadiness, type AnswerEnv } from "../src/answer";
import {
  createTicket,
  ensureAnswerSchema,
  newTicketId,
  readCheckpoint,
  saveCheckpoint,
  ticketResult
} from "../src/answer-state";
import { FACILITATOR_URL, mockFacilitator } from "./facilitator";
import { scriptModel } from "./model";
import { FIXTURE_PUBLICATION_ID } from "./setup";
import { captureSpans } from "./tracing";

const PROXY = "Act as Ada's concise, evidence-first proxy with no hedging.";
const ANSWER_PRICE = 0.25;

beforeAll(async () => {
  await ensureAnswerSchema(env.LORE_DB);
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
    ),
    env.LORE_DB.prepare("INSERT OR REPLACE INTO node_settings(key,value) VALUES ('listed_name', 'Ada')")
  ]);
});

type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;
type PaymentRequired = Parameters<x402Client["createPaymentPayload"]>[0];

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-answer-test", version: "0.1.0" });
  const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    exports.default.fetch(input, init)) as typeof fetch;
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://worker.test/mcp"), { fetch: workerFetch })
  );
  return client;
}

function textOf(result: CallToolResult): Record<string, unknown> {
  const text = (result.content as { text: string }[])[0].text;
  return JSON.parse(text) as Record<string, unknown>;
}

function x402ErrorOf(result: CallToolResult): PaymentRequired {
  const error = result._meta?.["x402/error"];
  expect(error).toBeTruthy();
  return error as PaymentRequired;
}

async function buildPaymentToken(x402Error: PaymentRequired): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  const paymentClient = new x402Client();
  registerExactEvmScheme(paymentClient, { signer: toClientEvmSigner(account) });
  const paymentPayload = await paymentClient.createPaymentPayload(x402Error);
  return btoa(JSON.stringify(paymentPayload));
}

async function buyAnswer(client: Client, question: string): Promise<string> {
  const challenge = await client.callTool({ name: "answer", arguments: { question } });
  expect(challenge.isError).toBe(true);
  const token = await buildPaymentToken(x402ErrorOf(challenge));
  const paid = await client.callTool({
    name: "answer",
    arguments: { question },
    _meta: { "x402/payment": token }
  });
  expect(paid.isError).toBeUndefined();
  const payload = textOf(paid);
  expect(payload.status).toBe("running");
  expect(payload.retention_disclosure).toBeTruthy();
  return payload.ticket as string;
}

async function pollResult(client: Client, ticket: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await client.callTool({ name: "result", arguments: { ticket } });
    const payload = textOf(result);
    if (payload.status !== "running") return payload;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("ticket never left running");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("answer (paid) and result", () => {
  it("resumes a checkpointed tool turn in a fresh agent", async () => {
    const ticket = await createTicket(env, "What does the fixture teach?", ANSWER_PRICE);
    const messages: AgentMessage[] = [
      { role: "user", content: "checkpointed buyer question", timestamp: 1 },
      {
        role: "assistant",
        api: "anthropic-messages",
        provider: "anthropic",
        model: "claude-sonnet-5",
        content: [
          {
            type: "toolCall",
            id: "toolu_checkpoint",
            name: "memory_view",
            arguments: { public_id: FIXTURE_PUBLICATION_ID }
          }
        ],
        usage: {
          input: 1000,
          output: 200,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1200,
          cost: { input: 0.003, output: 0.001, cacheRead: 0, cacheWrite: 0, total: 0.004 }
        },
        stopReason: "toolUse",
        timestamp: 2
      },
      {
        role: "toolResult",
        toolCallId: "toolu_checkpoint",
        toolName: "memory_view",
        content: [{ type: "text", text: '{"id":"0000000000000000fcdb4b42"}' }],
        details: {},
        isError: false,
        timestamp: 3
      }
    ];
    const objectId = env.LorePaidMCP.idFromName("checkpoint-resume");
    await runInDurableObject(env.LorePaidMCP.get(objectId), () =>
      saveCheckpoint(env, ticket, {
        messages,
        turns: 1,
        viewed: [FIXTURE_PUBLICATION_ID]
      })
    );
    const stored = await env.LORE_DB.prepare(
      "SELECT messages FROM answer_checkpoints WHERE ticket_id=?1"
    )
      .bind(ticket)
      .first<{ messages: string }>();
    expect(stored?.messages).not.toContain(PROXY);
    expect(stored?.messages).not.toContain("test-key");

    const model = scriptModel([
      {
        tool: "submit_answer",
        input: {
          answer: "Resumed answer from Ada's proxy.",
          cited_publication_ids: [FIXTURE_PUBLICATION_ID]
        }
      }
    ]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) =>
      model.otherwise(new Request(input, init))
    );
    await abortAllDurableObjects();
    const freshObject = env.LorePaidMCP.get(objectId);
    await freshObject.runAnswerTicket({ ticketId: ticket });

    expect(await ticketResult(env, ticket)).toMatchObject({
      status: "complete",
      answer: "Resumed answer from Ada's proxy."
    });
    expect(await readCheckpoint(env, ticket)).toBeNull();
    expect(model.requests).toHaveLength(1);
    const row = await env.LORE_DB.prepare(
      "SELECT input_tokens,output_tokens,cost_usd,tool_calls FROM answer_jobs WHERE ticket_id=?1"
    )
      .bind(ticket)
      .first();
    expect(row).toEqual({ input_tokens: 2000, output_tokens: 400, cost_usd: 0.008, tool_calls: 2 });
    await freshObject.runAnswerTicket({ ticketId: ticket });
    expect(model.requests).toHaveLength(1);
  });

  it.each([undefined, "start", "attributes", "end"] as const)("completes a paid answer with tracing failure %s", async (failure) => {
    if (failure) captureSpans(failure);
    const bogus = newTicketId();
    const model = scriptModel([
      { tool: "memory_view", input: { public_id: FIXTURE_PUBLICATION_ID } },
      {
        tool: "submit_answer",
        input: {
          answer: "Grounded answer from Ada's proxy.",
          cited_publication_ids: [FIXTURE_PUBLICATION_ID, bogus, "not-an-id"]
        }
      }
    ]);
    mockFacilitator({ otherwise: model.otherwise });
    const client = await connect();
    try {
      const discover = textOf(await client.callTool({ name: "discover", arguments: {} }));
      expect(discover.answer_price_usd).toBe(ANSWER_PRICE);
      expect(discover.answer_retention_disclosure).toContain("retained");
      expect([discover.listed, discover.name]).toEqual([true, "Ada"]);

      const ticket = await buyAnswer(client, "What does the fixture teach?");
      const outcome = await pollResult(client, ticket);
      expect(outcome.status).toBe("complete");
      expect(outcome.answer).toBe("Grounded answer from Ada's proxy.");
      expect(outcome.cited_publication_ids).toEqual([FIXTURE_PUBLICATION_ID]);

      const kickoff = (model.requests[0] as {
        messages: { content: { type: string; text: string }[] }[];
      }).messages[0];
      const kickoffText = kickoff.content.map(({ text }) => text).join("");
      expect(kickoffText).toContain("<available_publications>");
      expect(kickoffText).toContain("a teaser that is safe to advertise");
      expect(kickoffText).not.toContain("owner-approved content");

      const gatherRequest = model.requests[0] as { tools: { name: string }[] };
      expect(gatherRequest.tools.map((tool) => tool.name).sort()).toEqual([
        "memory_search",
        "memory_view",
        "refuse",
        "submit_answer"
      ]);
      const agentRequest = model.requests[1] as { system: { type: string; text: string }[] };
      const system = agentRequest.system.map(({ text }) => text).join("");
      expect(system).toContain(PROXY);

      const row = await env.LORE_DB.prepare(
        "SELECT model, input_tokens, output_tokens, cost_usd, tool_calls FROM answer_jobs WHERE ticket_id = ?1"
      )
        .bind(ticket)
        .first<{ model: string; input_tokens: number; cost_usd: number; tool_calls: number }>();
      expect(row?.model).toBe("claude-sonnet-5");
      expect(row?.input_tokens).toBe(2000);
      expect(row?.cost_usd).toBeGreaterThan(0);
      expect(row?.tool_calls).toBe(2);
    } finally {
      await client.close();
    }
  });

  it("records the answer job's telemetry on a span, and never the buyer's question", async () => {
    const spans = captureSpans();
    const model = scriptModel([
      { tool: "memory_view", input: { public_id: FIXTURE_PUBLICATION_ID } },
      {
        tool: "submit_answer",
        input: { answer: "Grounded answer.", cited_publication_ids: [FIXTURE_PUBLICATION_ID] }
      }
    ]);
    mockFacilitator({ otherwise: model.otherwise });
    const client = await connect();
    try {
      const question = "What does the fixture teach, and where exactly do I live?";
      const ticket = await buyAnswer(client, question);
      await pollResult(client, ticket);

      const jobSpan = spans.find((s) => s.name === "lore.answer.job");
      expect(jobSpan?.attributes["lore.answer.model"]).toBe("claude-sonnet-5");
      expect(jobSpan?.attributes["lore.answer.tool_calls"]).toBe(2);
      expect(typeof jobSpan?.attributes["lore.answer.cost_usd"]).toBe("number");
      expect(typeof jobSpan?.attributes["lore.answer.duration_ms"]).toBe("number");

      const ticketSpan = spans.find((s) => s.name === "lore.answer");
      expect(ticketSpan?.attributes["lore.outcome"]).toBe("ok");

      const serialized = JSON.stringify(spans);
      expect(serialized).not.toContain(question);
      expect(serialized).not.toContain("where exactly do I live");
      expect(serialized).not.toContain("Grounded answer");
    } finally {
      await client.close();
    }
  });

  it("stores an honest refusal when the publications do not cover the question", async () => {
    const model = scriptModel([
      { tool: "refuse", input: { reason: "the publications do not cover quantum farming" } }
    ]);
    mockFacilitator({ otherwise: model.otherwise });
    const client = await connect();
    try {
      const ticket = await buyAnswer(client, "How do I farm quantum wheat?");
      const outcome = await pollResult(client, ticket);
      expect(outcome.status).toBe("refused");
      expect(outcome.reason).toContain("quantum farming");
      expect(outcome.note).toContain("refund");
    } finally {
      await client.close();
    }
  });

  it("fails the ticket with the no-refund note when the model API errors", async () => {
    const model = scriptModel({ status: 500 });
    mockFacilitator({ otherwise: model.otherwise });
    const client = await connect();
    try {
      const ticket = await buyAnswer(client, "What does the fixture teach?");
      const outcome = await pollResult(client, ticket);
      expect(outcome.status).toBe("failed");
      expect(outcome.note).toContain("refund");
    } finally {
      await client.close();
    }
  });
});

describe("an answer tier the node cannot run", () => {
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
});
