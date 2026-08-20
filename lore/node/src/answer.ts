import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  type AnswerOutcome,
  type AnswerTelemetry,
  finishJob,
  manifest,
  readAnswerSettings,
  runningJob
} from "./answer-state.js";
import { createAnswerTools } from "./answer-tools.js";

const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_MODEL_TURNS = 6;
const DEADLINE_MS = 180_000;

export type AnswerEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LORE_ANSWER_MODEL?: string;
};

function systemPrompt(proxy: string): string {
  return (
    `${proxy.trim()}\n\n` +
    "You are the node owner's authorized AI proxy. Speak directly to the buyer in first person " +
    "as the owner would, but never imply the owner is present. Use only the owner's approved " +
    "publications. Read every publication you rely on. Do not invent current beliefs, actions, " +
    "availability, or commitments. Submit an answer with exactly the publication ids it uses, " +
    "or refuse when the publications do not cover the question. View matching manifest teasers " +
    "directly; search only when no teaser matches."
  );
}

function modelConfig(env: AnswerEnv): { id: string; provider: Provider; apiKey: string } {
  const id = env.LORE_ANSWER_MODEL || DEFAULT_MODEL;
  if (id === "claude-sonnet-5") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("the node has no ANTHROPIC_API_KEY secret");
    return { id, provider: anthropicProvider(), apiKey: env.ANTHROPIC_API_KEY };
  }
  if (id === "gpt-5.6-luna") {
    if (!env.OPENAI_API_KEY) throw new Error("the node has no OPENAI_API_KEY secret");
    return { id, provider: openaiProvider(), apiKey: env.OPENAI_API_KEY };
  }
  throw new Error(`unsupported answer model: ${id}`);
}

export async function runAnswer(
  env: AnswerEnv,
  ticketId: string,
  onToolCall?: (name: string) => void
): Promise<void> {
  const started = Date.now();
  const job = await runningJob(env, ticketId);
  if (!job) return;

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
        toolChoice: nextModel.provider === "anthropic" ? "auto" : "required"
      };
      return selected.provider.streamSimple(nextModel, context, requestOptions);
    };

    let turns = 0;
    const settings = await readAnswerSettings(env.LORE_DB);
    const agent = new Agent({
      streamFn,
      toolExecution: "sequential",
      shouldStopAfterTurn: () => Boolean(outcome) || ++turns >= MAX_MODEL_TURNS,
      initialState: {
        systemPrompt: systemPrompt(settings.proxy),
        model,
        tools: createAnswerTools(env, (next) => {
          outcome ??= next;
        })
      }
    });
    agent.subscribe((event) => {
      if (event.type === "tool_execution_start") onToolCall?.(event.toolName);
    });

    const catalog = JSON.stringify(await manifest(env));
    const timer = setTimeout(() => agent.abort(), DEADLINE_MS);
    try {
      await agent.prompt(
        `<available_publications>\n${catalog}\n</available_publications>\n\n` +
          `Answer this question from a paying buyer:\n${job.question}`
      );
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
  await finishJob(env, ticketId, outcome, telemetry);
}
