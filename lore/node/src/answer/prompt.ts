/** The answer agent's system prompt and its model choice, a leaf module (XC-100): no tracing, so no
 * `cloudflare:workers`, and the rules are tested in plain node. `answer.ts` runs the agent with them. */
import type { Provider } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";

export const DEFAULT_MODEL = "claude-sonnet-5";

export type AnswerEnv = Env & {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LORE_ANSWER_MODEL?: string;
};

export function systemPrompt(proxy: string): string {
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

export type ModelConfig = { id: string; provider: Provider; apiKey: string };

/** The one place that maps the configured model to its provider and the binding it needs. */
export function resolveModel(env: AnswerEnv): { config: ModelConfig } | { reason: string } {
  const id = env.LORE_ANSWER_MODEL || DEFAULT_MODEL;
  if (id === "claude-sonnet-5") {
    if (!env.ANTHROPIC_API_KEY) return { reason: "the node has no ANTHROPIC_API_KEY secret" };
    return { config: { id, provider: anthropicProvider(), apiKey: env.ANTHROPIC_API_KEY } };
  }
  if (id === "gpt-5.6-luna") {
    if (!env.OPENAI_API_KEY) return { reason: "the node has no OPENAI_API_KEY secret" };
    return { config: { id, provider: openaiProvider(), apiKey: env.OPENAI_API_KEY } };
  }
  return { reason: `unsupported answer model: ${id}` };
}
