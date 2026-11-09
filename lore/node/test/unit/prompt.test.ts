// XC-100: the answer agent's system prompt and model choice, without tracing or a Worker. answer-unready.test.ts
// still covers how the Worker advertises `answer` from the same choice.
import { describe, expect, it } from "vitest";
import { type AnswerEnv, DEFAULT_MODEL, resolveModel, systemPrompt } from "../../src/answer/prompt.js";

const env = (overrides: Partial<AnswerEnv> = {}) => overrides as AnswerEnv;

describe("systemPrompt", () => {
  it("puts the owner's trimmed preamble first, then the proxy's rules", () => {
    const prompt = systemPrompt("  I am Dipak's proxy.\n");
    expect(prompt.startsWith("I am Dipak's proxy.\n\nYou are the node owner's authorized AI proxy.")).toBe(true);
  });

  it.each([
    "never imply the owner is present",
    "Use only the owner's approved publications",
    "Read every publication you rely on",
    "Do not invent current beliefs",
    "exactly the publication ids it uses",
    "refuse when the publications do not cover the question",
    "search only when no teaser matches"
  ])("tells the agent: %s", (rule) => {
    expect(systemPrompt("p")).toContain(rule);
  });
});

describe("resolveModel", () => {
  it("defaults to Claude Sonnet", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5");
  });

  it.each([
    ["the default model with an Anthropic key", {}, { ANTHROPIC_API_KEY: "a" }, "claude-sonnet-5", "anthropic", "a"],
    ["an empty model name, read as the default", { LORE_ANSWER_MODEL: "" }, { ANTHROPIC_API_KEY: "a" }, "claude-sonnet-5", "anthropic", "a"],
    ["GPT with an OpenAI key", { LORE_ANSWER_MODEL: "gpt-5.6-luna" }, { OPENAI_API_KEY: "o" }, "gpt-5.6-luna", "openai", "o"]
  ])("resolves %s", (_, model, keys, id, provider, apiKey) => {
    const resolved = resolveModel(env({ ...model, ...keys }));
    expect("config" in resolved && resolved.config.id).toBe(id);
    expect("config" in resolved && resolved.config.apiKey).toBe(apiKey);
    expect("config" in resolved && resolved.config.provider.getModels().some((m) => m.id === id && m.provider === provider)).toBe(
      true
    );
  });

  it.each([
    ["Claude without its key", {}, "the node has no ANTHROPIC_API_KEY secret"],
    ["Claude with only the OpenAI key", { OPENAI_API_KEY: "o" }, "the node has no ANTHROPIC_API_KEY secret"],
    ["GPT without its key", { LORE_ANSWER_MODEL: "gpt-5.6-luna", ANTHROPIC_API_KEY: "a" }, "the node has no OPENAI_API_KEY secret"],
    ["a model Lore doesn't run", { LORE_ANSWER_MODEL: "gpt-4", OPENAI_API_KEY: "o" }, "unsupported answer model: gpt-4"]
  ])("refuses %s, naming the missing binding and never a value", (_, overrides: Partial<AnswerEnv>, reason) => {
    expect(resolveModel(env(overrides))).toEqual({ reason });
  });
});
