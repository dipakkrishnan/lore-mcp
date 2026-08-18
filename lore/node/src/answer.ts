import { createHash } from "node:crypto";

export const RETENTION_DISCLOSURE =
  "Questions sent to this node are retained and visible to its owner.";
export const ANSWER_DISCLOSURE =
  "Answer synthesized from owner-approved publications; verify citations via get.";
const NO_REFUND_NOTE = "No automated refund exists yet; contact the node owner.";

const MAX_MODEL_TURNS = 6;
const MAX_TOOL_CALLS = 15;
const DEADLINE_MS = 180_000;
const RESULT_GRACE_MS = 60_000;
export const ESTIMATE_SECONDS = 120;

const DEFAULT_MODEL = "claude-opus-5";
const MODEL_RATES: Record<string, [number, number]> = {
  "claude-opus-5": [5, 25],
  "claude-fable-5": [10, 50],
  "claude-sonnet-5": [3, 15],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5]
};

export type AnswerEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  LORE_ANSWER_MODEL?: string;
};

export interface AnswerSettings {
  enabled: boolean;
  priceUsd: number;
  persona: string;
}

interface ManifestRow {
  id: string;
  teaser: string;
  topic: string;
  kind: string;
  updated_at: string;
}

export async function manifest(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.LORE_DB.prepare(
    `SELECT public_id AS id, teaser, topic, kind,
            substr(updated_at, 1, 10) AS updated_at
     FROM publications WHERE teaser <> ''
     ORDER BY topic, updated_at DESC, public_id`
  ).all<ManifestRow>();
  const topics: Record<string, object[]> = {};
  for (const { id, teaser, topic, kind, updated_at } of results) {
    (topics[topic] ??= []).push({ id, teaser, kind, updated_at });
  }
  return { manifest_version: 1, publication_count: results.length, topics };
}

export function validPublicId(value: string): boolean {
  const body = value.slice(0, 16);
  return (
    /^[0-9a-f]{24}$/.test(value) &&
    value.slice(16) === createHash("sha256").update(body).digest("hex").slice(0, 8)
  );
}

export function newTicketId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const body = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return body + createHash("sha256").update(body).digest("hex").slice(0, 8);
}

export async function readAnswerSettings(db: D1Database): Promise<AnswerSettings> {
  let rows: { key: string; value: string }[];
  try {
    const { results } = await db
      .prepare("SELECT key, value FROM node_settings")
      .all<{ key: string; value: string }>();
    rows = results;
  } catch {
    return { enabled: false, priceUsd: 0, persona: "" };
  }
  const values = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  const priceUsd = Number(values.answer_price_usd ?? 0);
  const persona = values.persona_preamble ?? "";
  const enabled =
    values.answer_enabled === "true" && persona.trim() !== "" && Number.isFinite(priceUsd) && priceUsd > 0;
  return { enabled, priceUsd, persona };
}

export async function ensureAnswerSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS answer_tickets (" +
        "ticket_id TEXT PRIMARY KEY, question TEXT NOT NULL, " +
        "price_usd REAL NOT NULL, status TEXT NOT NULL DEFAULT 'running', " +
        "created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS answers (" +
        "ticket_id TEXT PRIMARY KEY, answer TEXT NOT NULL DEFAULT '', " +
        "cited_publication_ids TEXT NOT NULL DEFAULT '[]', refusal_reason TEXT NOT NULL DEFAULT '', " +
        "model TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, " +
        "output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, " +
        "tool_calls INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0, " +
        "completed_at TEXT NOT NULL DEFAULT '')"
    )
  ]);
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ModelResponse {
  model: string;
  content: (ToolUseBlock | { type: string })[];
  usage: { input_tokens: number; output_tokens: number };
}

interface ModelTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

function answerModel(env: AnswerEnv): string {
  return env.LORE_ANSWER_MODEL || DEFAULT_MODEL;
}

async function callModel(
  env: AnswerEnv,
  system: string,
  messages: object[],
  tools: ModelTool[]
): Promise<ModelResponse> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error("the node has no ANTHROPIC_API_KEY secret; the owner must set one");
  }
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: answerModel(env),
      max_tokens: 4096,
      system,
      messages,
      tools,
      tool_choice: { type: "any" }
    })
  });
  if (!response.ok) {
    throw new Error(`model call failed: ${response.status} ${await response.text()}`);
  }
  return await response.json();
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toolUses(response: ModelResponse): ToolUseBlock[] {
  return response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
}

function cost(model: string, inputTokens: number, outputTokens: number): number {
  const [input, output] = MODEL_RATES[model] ?? [0, 0];
  return (inputTokens * input + outputTokens * output) / 1_000_000;
}

const MEMORY_VIEW_TOOLS: ModelTool[] = [
  {
    name: "memory_view",
    description:
      "Read one publication's full content by the public_id listed in " +
      "<available_publications>.",
    input_schema: {
      type: "object",
      properties: { public_id: { type: "string" } },
      required: ["public_id"],
      additionalProperties: false
    }
  },
  {
    name: "memory_search",
    description: "Search publication titles, teasers, and content for words.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false
    }
  }
];

const FINISH_TOOLS: ModelTool[] = [
  {
    name: "submit_answer",
    description:
      "Deliver the final answer, grounded only in publications you read, " +
      "citing every publication id it draws from.",
    input_schema: {
      type: "object",
      properties: {
        answer: { type: "string" },
        cited_publication_ids: { type: "array", items: { type: "string" } }
      },
      required: ["answer", "cited_publication_ids"],
      additionalProperties: false
    }
  },
  {
    name: "refuse",
    description:
      "Decline because the publications do not cover the question. State the honest reason.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
      additionalProperties: false
    }
  }
];

async function runMemoryView(env: Env, name: string, input: Record<string, unknown>): Promise<string> {
  if (name === "memory_view") {
    const id = asString(input.public_id);
    if (!validPublicId(id)) return JSON.stringify({ error: "invalid publication id" });
    const row = await env.LORE_DB.prepare(
      "SELECT public_id AS id, title, content, topic, kind FROM publications WHERE public_id = ?1"
    )
      .bind(id)
      .first();
    return JSON.stringify(row ?? { error: `publication not found: ${id}` });
  }
  if (name === "memory_search") {
    // ponytail: LIKE is enough until real corpus sizes justify FTS.
    const needle = `%${asString(input.query).replace(/[%_]/g, " ")}%`;
    const { results } = await env.LORE_DB.prepare(
      "SELECT public_id AS id, title, teaser, topic FROM publications " +
        "WHERE title LIKE ?1 OR teaser LIKE ?1 OR content LIKE ?1 OR topic LIKE ?1 LIMIT 8"
    )
      .bind(needle)
      .all();
    return JSON.stringify(results);
  }
  return JSON.stringify({ error: `unknown tool: ${name}` });
}

function systemPrompt(persona: string): string {
  return (
    `${persona.trim()}\n\n` +
    "You answer a paying buyer's question strictly from this node's " +
    "owner-approved publications, in the owner's voice as described above. " +
    "Rules, in order: read every publication you rely on before using it; " +
    "never state anything the publications do not support; before submitting, " +
    "re-check that each claim traces to a publication you read and that " +
    "cited_publication_ids lists exactly those ids; if the publications do " +
    "not cover the question, call refuse with an honest reason instead of " +
    "guessing."
  );
}

interface TicketRow {
  ticket_id: string;
  question: string;
  price_usd: number;
  status: string;
  created_at: string;
}

export async function createTicket(env: Env, question: string, priceUsd: number): Promise<string> {
  const ticketId = newTicketId();
  const now = new Date().toISOString();
  await env.LORE_DB.prepare(
    "INSERT INTO answer_tickets(ticket_id,question,price_usd,status,created_at,updated_at) " +
      "VALUES (?1,?2,?3,'running',?4,?4)"
  )
    .bind(ticketId, question, priceUsd, now)
    .run();
  return ticketId;
}

interface Finish {
  status: "complete" | "refused" | "failed";
  answer?: string;
  cited?: string[];
  reason?: string;
}

interface Telemetry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  toolCalls: number;
}

async function persistOutcome(
  env: Env,
  ticketId: string,
  finish: Finish,
  telemetry: Telemetry,
  startedMs: number
): Promise<void> {
  const now = new Date().toISOString();
  await env.LORE_DB.batch([
    env.LORE_DB.prepare(
      "INSERT OR REPLACE INTO answers(ticket_id,answer,cited_publication_ids,refusal_reason," +
        "model,input_tokens,output_tokens,cost_usd,tool_calls,duration_ms,completed_at) " +
        "VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)"
    ).bind(
      ticketId,
      finish.answer ?? "",
      JSON.stringify(finish.cited ?? []),
      finish.reason ?? "",
      telemetry.model,
      telemetry.inputTokens,
      telemetry.outputTokens,
      telemetry.costUsd,
      telemetry.toolCalls,
      Date.now() - startedMs,
      now
    ),
    env.LORE_DB.prepare(
      "UPDATE answer_tickets SET status=?2, updated_at=?3 WHERE ticket_id=?1"
    ).bind(ticketId, finish.status, now)
  ]);
}

async function validCitations(env: Env, cited: string[]): Promise<string[]> {
  const candidates = [...new Set(cited.filter(validPublicId))];
  if (!candidates.length) return [];
  const placeholders = candidates.map((_, i) => `?${i + 1}`).join(",");
  const { results } = await env.LORE_DB.prepare(
    `SELECT public_id FROM publications WHERE public_id IN (${placeholders})`
  )
    .bind(...candidates)
    .all<{ public_id: string }>();
  return results.map((row) => row.public_id);
}

export async function runAnswer(env: AnswerEnv, ticketId: string): Promise<void> {
  const started = Date.now();
  const telemetry: Telemetry = {
    model: answerModel(env),
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    toolCalls: 0
  };
  const ticket = await env.LORE_DB.prepare(
    "SELECT ticket_id, question, price_usd, status, created_at FROM answer_tickets WHERE ticket_id = ?1"
  )
    .bind(ticketId)
    .first<TicketRow>();
  if (!ticket || ticket.status !== "running") return;

  try {
    const settings = await readAnswerSettings(env.LORE_DB);
    const catalog = JSON.stringify(await manifest(env));
    const messages: object[] = [
      {
        role: "user",
        content:
          `<available_publications>\n${catalog}\n</available_publications>\n\n` +
          `Answer this question from a paying buyer:\n${ticket.question}`
      }
    ];

    let finish: Finish | undefined;
    for (let turn = 1; turn <= MAX_MODEL_TURNS && !finish; turn++) {
      const last =
        turn === MAX_MODEL_TURNS ||
        telemetry.toolCalls >= MAX_TOOL_CALLS ||
        telemetry.costUsd >= ticket.price_usd ||
        Date.now() - started >= DEADLINE_MS;
      const tools = last ? FINISH_TOOLS : [...MEMORY_VIEW_TOOLS, ...FINISH_TOOLS];
      const response = await callModel(env, systemPrompt(settings.persona), messages, tools);
      telemetry.model = response.model;
      telemetry.inputTokens += response.usage.input_tokens;
      telemetry.outputTokens += response.usage.output_tokens;
      telemetry.costUsd = cost(
        response.model,
        telemetry.inputTokens,
        telemetry.outputTokens
      );
      messages.push({ role: "assistant", content: response.content });

      const results: object[] = [];
      for (const block of toolUses(response)) {
        telemetry.toolCalls += 1;
        if (block.name === "submit_answer") {
          const cited = Array.isArray(block.input.cited_publication_ids)
            ? block.input.cited_publication_ids.map(String)
            : [];
          finish = {
            status: "complete",
            answer: asString(block.input.answer),
            cited: await validCitations(env, cited)
          };
          break;
        }
        if (block.name === "refuse") {
          finish = { status: "refused", reason: asString(block.input.reason) || "no coverage" };
          break;
        }
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: await runMemoryView(env, block.name, block.input)
        });
      }
      if (!finish) messages.push({ role: "user", content: results });
    }
    await persistOutcome(
      env,
      ticketId,
      finish ?? { status: "failed", reason: "the agent exhausted its budget without an answer" },
      telemetry,
      started
    );
  } catch (error) {
    await persistOutcome(
      env,
      ticketId,
      { status: "failed", reason: String(error).slice(0, 500) },
      telemetry,
      started
    );
  }
}

interface OutcomeRow extends TicketRow {
  answer: string | null;
  cited_publication_ids: string | null;
  refusal_reason: string | null;
}

export async function ticketResult(env: Env, ticketId: string): Promise<Record<string, unknown>> {
  const row = await env.LORE_DB.prepare(
    "SELECT t.ticket_id, t.question, t.price_usd, t.status, t.created_at, " +
      "a.answer, a.cited_publication_ids, a.refusal_reason " +
      "FROM answer_tickets t LEFT JOIN answers a ON a.ticket_id = t.ticket_id " +
      "WHERE t.ticket_id = ?1"
  )
    .bind(ticketId)
    .first<OutcomeRow>();
  if (!row) return { error: `ticket not found: ${ticketId}` };
  if (row.status === "running") {
    const age = Date.now() - Date.parse(row.created_at);
    if (age > DEADLINE_MS + RESULT_GRACE_MS) {
      const reason = "the agent did not finish in time";
      await env.LORE_DB.prepare(
        "UPDATE answer_tickets SET status='failed', updated_at=?2 WHERE ticket_id=?1 AND status='running'"
      )
        .bind(ticketId, new Date().toISOString())
        .run();
      return { status: "failed", reason, note: NO_REFUND_NOTE };
    }
    return { status: "running", estimate_seconds: ESTIMATE_SECONDS };
  }
  if (row.status === "complete") {
    return {
      status: "complete",
      answer: row.answer ?? "",
      cited_publication_ids: JSON.parse(row.cited_publication_ids ?? "[]") as string[],
      disclosure: ANSWER_DISCLOSURE
    };
  }
  if (row.status === "refused") {
    return { status: "refused", reason: row.refusal_reason ?? "", note: NO_REFUND_NOTE };
  }
  return { status: "failed", reason: row.refusal_reason ?? "agent error", note: NO_REFUND_NOTE };
}
