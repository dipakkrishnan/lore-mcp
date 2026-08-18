import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { runAnswer, type AnswerEnv } from "../src/answer";
import { createTicket, ensureAnswerSchema, ticketResult } from "../src/answer-state";
import { scriptModel } from "../test/model";

interface EvalInput {
  proxy: string;
  price: number;
  publications: {
    public_id: string;
    title: string;
    content: string;
    kind: string;
    topic: string;
    teaser: string;
    updated_at: string;
  }[];
}

type EvalEnv = AnswerEnv & {
  LORE_EVAL_INPUT: string;
  LORE_EVAL_QUESTION: string;
  LORE_TEST_FAKE?: string;
};

afterEach(() => vi.restoreAllMocks());

it("runs the owner's proxy", async () => {
  const evalEnv = env as EvalEnv;
  const input = JSON.parse(evalEnv.LORE_EVAL_INPUT) as EvalInput;
  await evalEnv.LORE_DB.exec(
    "CREATE TABLE publications (public_id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL, topic TEXT NOT NULL, teaser TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
  await ensureAnswerSchema(evalEnv.LORE_DB);
  await evalEnv.LORE_DB.batch([
    ...input.publications.map((publication) =>
      evalEnv.LORE_DB.prepare(
        "INSERT INTO publications(public_id,title,content,kind,topic,teaser,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)"
      ).bind(
        publication.public_id,
        publication.title,
        publication.content,
        publication.kind,
        publication.topic,
        publication.teaser,
        publication.updated_at
      )
    ),
    evalEnv.LORE_DB.prepare("INSERT INTO node_settings(key,value) VALUES ('proxy_preamble',?1)").bind(
      input.proxy
    ),
    evalEnv.LORE_DB.prepare(
      "INSERT INTO node_settings(key,value) VALUES ('answer_price_usd',?1)"
    ).bind(String(input.price)),
    evalEnv.LORE_DB.prepare("INSERT INTO node_settings(key,value) VALUES ('answer_enabled','true')")
  ]);

  if (evalEnv.LORE_TEST_FAKE === "1") {
    const first = input.publications[0];
    const model = scriptModel([
      { tool: "memory_view", input: { public_id: first.public_id } },
      {
        tool: "submit_answer",
        input: {
          answer: "Deterministic proxy evaluation passed.",
          cited_publication_ids: [first.public_id]
        }
      }
    ]);
    vi.spyOn(globalThis, "fetch").mockImplementation((request, init) =>
      model.otherwise(new Request(request, init))
    );
  }

  const ticket = await createTicket(evalEnv, evalEnv.LORE_EVAL_QUESTION, input.price);
  await runAnswer(evalEnv, ticket);
  const result = await ticketResult(evalEnv, ticket);
  const telemetry = await evalEnv.LORE_DB.prepare(
    "SELECT model,input_tokens,output_tokens,cost_usd,tool_calls,duration_ms FROM answer_jobs WHERE ticket_id=?1"
  )
    .bind(ticket)
    .first();

  console.log(
    `\n${JSON.stringify({ question: evalEnv.LORE_EVAL_QUESTION, result, telemetry }, null, 2)}\n`
  );
  expect(result.status, JSON.stringify(result)).not.toBe("failed");
});
