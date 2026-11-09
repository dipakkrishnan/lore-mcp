import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { type AnswerEnv, DEFAULT_MODEL, type ModelConfig, resolveModel, systemPrompt } from "./answer/prompt.js";
import { answerSpanAttributes } from "./telemetry.js";
import { withSpan, type SetAttributes } from "./tracing.js";
import {
  type AnswerOutcome,
  type AnswerTelemetry,
  finishJob,
  manifest,
  readCheckpoint,
  readAnswerSettings,
  runningJob,
  saveCheckpoint
} from "./answer-state.js";
import { createAnswerTools } from "./answer-tools.js";

const MAX_MODEL_TURNS = 6;
const DEADLINE_MS = 180_000;

export type { AnswerEnv } from "./answer/prompt.js";

function modelConfig(env: AnswerEnv): ModelConfig {
  const resolved = resolveModel(env);
  if ("reason" in resolved) throw new Error(resolved.reason);
  return resolved.config;
}

/**
 * Whether this node could run an answer it is paid for (MON-017). Checked before `answer` is
 * advertised or charged, so a buyer never pays for a failure the node already knew about. The
 * reason names only the missing binding or the unsupported model, never a value.
 */
export function answerReadiness(env: AnswerEnv): { ready: true } | { ready: false; reason: string } {
  const resolved = resolveModel(env);
  return "reason" in resolved ? { ready: false, reason: resolved.reason } : { ready: true };
}

export async function runAnswer(
  env: AnswerEnv,
  ticketId: string,
  onToolCall?: (name: string) => void
): Promise<void> {
  const job = await runningJob(env, ticketId);
  if (!job) return;
  // Never the buyer's question, and never the answer text — only the
  // telemetry the job already computes and persists to D1 (answer_jobs).
  await withSpan("lore.answer.job", (setAttributes) => runAnswerJob(env, ticketId, job.question, setAttributes, onToolCall));
}

async function runAnswerJob(
  env: AnswerEnv,
  ticketId: string,
  question: string,
  setAttributes: SetAttributes,
  onToolCall?: (name: string) => void
): Promise<void> {
  const started = Date.now();
  let requestedModel = env.LORE_ANSWER_MODEL || DEFAULT_MODEL;
  let outcome: AnswerOutcome | undefined;
  const telemetry: AnswerTelemetry = {
    model: requestedModel,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    toolCalls: 0,
    durationMs: 0
  };

  try {
    const selected = modelConfig(env);
    requestedModel = selected.id;
    const model = selected.provider.getModels().find(({ id }) => id === selected.id);
    if (!model) throw new Error(`Pi does not know model: ${selected.id}`);

    const streamFn: StreamFn = (nextModel, context, options) => {
      const requestOptions = {
        ...options,
        apiKey: selected.apiKey,
        maxTokens: 1024,
        toolChoice: nextModel.provider === "anthropic" ? "any" : "required"
      };
      return selected.provider.streamSimple(nextModel, context, requestOptions);
    };

    const checkpoint = await readCheckpoint(env, ticketId);
    let turns = checkpoint?.turns ?? 0;
    const viewed = new Set(checkpoint?.viewed ?? []);
    const settings = await readAnswerSettings(env.LORE_DB);
    const agent = new Agent({
      streamFn,
      toolExecution: "sequential",
      shouldStopAfterTurn: () => Boolean(outcome) || turns >= MAX_MODEL_TURNS,
      initialState: {
        systemPrompt: systemPrompt(settings.proxy),
        model,
        messages: checkpoint?.messages,
        tools: createAnswerTools(
          env,
          (next) => {
            outcome ??= next;
          },
          viewed
        )
      }
    });
    agent.subscribe((event) => {
      if (event.type === "tool_execution_start") onToolCall?.(event.toolName);
    });

    agent.subscribe(async (event) => {
      if (event.type !== "turn_end") return;
      turns += 1;
      await saveCheckpoint(env, ticketId, {
        messages: agent.state.messages,
        turns,
        viewed: [...viewed]
      });
    });

    const catalog = JSON.stringify(await manifest(env));
    const timer = setTimeout(() => agent.abort(), DEADLINE_MS);
    try {
      if (checkpoint) {
        await agent.continue();
      } else {
        await agent.prompt(
          `<available_publications>\n${catalog}\n</available_publications>\n\n` +
            `Answer this question from a paying buyer:\n${question}`
        );
      }
    } finally {
      clearTimeout(timer);
    }

    for (const message of agent.state.messages) {
      if (message.role === "assistant") {
        telemetry.model = message.model;
        telemetry.inputTokens += message.usage.input;
        telemetry.outputTokens += message.usage.output;
        telemetry.costUsd += message.usage.cost.total;
      } else if (message.role === "toolResult") {
        telemetry.toolCalls += 1;
      }
    }
    outcome ??= {
      status: "failed",
      reason: agent.state.errorMessage || "the agent stopped without submitting an answer"
    };
  } catch (error) {
    outcome = { status: "failed", reason: String(error).slice(0, 500) };
  }

  telemetry.model ||= requestedModel;
  telemetry.durationMs = Date.now() - started;
  setAttributes(() => answerSpanAttributes(telemetry));
  await finishJob(env, ticketId, outcome, telemetry);
}
