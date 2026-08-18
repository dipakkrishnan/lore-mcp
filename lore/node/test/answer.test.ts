import { toClientEvmSigner } from "@x402/evm";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { x402Client } from "@x402/core/client";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { newTicketId } from "../src/answer-state";
import { mockFacilitator } from "./facilitator";
import { FIXTURE_PUBLICATION_ID } from "./setup";

const PERSONA = "Answer as Ada: terse, evidence-first, no hedging.";
const ANSWER_PRICE = 0.25;

beforeAll(async () => {
  await env.LORE_DB.exec(
    "CREATE TABLE IF NOT EXISTS node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  await env.LORE_DB.batch([
    env.LORE_DB.prepare(
      "INSERT OR REPLACE INTO node_settings(key,value) VALUES ('persona_preamble', ?1)"
    ).bind(PERSONA),
    env.LORE_DB.prepare(
      "INSERT OR REPLACE INTO node_settings(key,value) VALUES ('answer_price_usd', ?1)"
    ).bind(String(ANSWER_PRICE)),
    env.LORE_DB.prepare(
      "INSERT OR REPLACE INTO node_settings(key,value) VALUES ('answer_enabled', 'true')"
    )
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

interface ModelTurn {
  tool: string;
  input: Record<string, unknown>;
}

function scriptModel(turns: ModelTurn[] | { status: number }) {
  const requests: Record<string, unknown>[] = [];
  let call = 0;
  const otherwise = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.hostname !== "api.anthropic.com") {
      throw new Error(`unexpected outbound fetch during test: ${request.method} ${url}`);
    }
    requests.push((await request.json()));
    if (!Array.isArray(turns)) {
      return Response.json({ error: "model down" }, { status: turns.status });
    }
    const turn = turns[Math.min(call++, turns.length - 1)];
    const events: [string, unknown][] = [
      [
        "message_start",
        {
          type: "message_start",
          message: {
            id: `msg_${call}`,
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: 1000,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0
            }
          }
        }
      ],
      [
        "content_block_start",
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "tool_use", id: `toolu_${call}`, name: turn.tool, input: {} }
        }
      ],
      [
        "content_block_delta",
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(turn.input) }
        }
      ],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      [
        "message_delta",
        {
          type: "message_delta",
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 200 }
        }
      ],
      ["message_stop", { type: "message_stop" }]
    ];
    return new Response(
      events
        .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data) ?? "null"}\n\n`)
        .join(""),
      { headers: { "content-type": "text/event-stream" } }
    );
  };
  return { requests, otherwise };
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
  it("sells a ticket, runs the agent in the owner's voice, and validates citations", async () => {
    const bogus = newTicketId();
    const model = scriptModel([
      { tool: "memory_view", input: { public_id: FIXTURE_PUBLICATION_ID } },
      {
        tool: "submit_answer",
        input: {
          answer: "Grounded answer in Ada's voice.",
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

      const ticket = await buyAnswer(client, "What does the fixture teach?");
      const outcome = await pollResult(client, ticket);
      expect(outcome.status).toBe("complete");
      expect(outcome.answer).toBe("Grounded answer in Ada's voice.");
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
      expect(agentRequest.system.map(({ text }) => text).join("")).toContain(PERSONA);

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
