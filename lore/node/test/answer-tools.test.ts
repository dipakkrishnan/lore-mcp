import type { AgentTool } from "@earendil-works/pi-agent-core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { AnswerOutcome } from "../src/answer-state";
import { createAnswerTools } from "../src/answer-tools";
import { FIXTURE_PUBLICATION_ID } from "./setup";

describe("answer tools", () => {
  it("accepts only citations the agent actually read", async () => {
    let outcome: AnswerOutcome | undefined;
    const tools = createAnswerTools(env, (next) => {
      outcome = next;
    });
    const execute = async (name: string, params: Record<string, unknown>) => {
      const tool = tools.find((candidate) => candidate.name === name) as AgentTool | undefined;
      if (!tool) throw new Error(`missing tool: ${name}`);
      return await tool.execute("test", params);
    };

    const read = await execute("memory_view", { public_id: FIXTURE_PUBLICATION_ID });
    expect(read.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(read.content)).toContain("secret owner-approved content");

    const submitted = await execute("submit_answer", {
      answer: "grounded",
      cited_publication_ids: [FIXTURE_PUBLICATION_ID, new Array(24).fill("f").join("")]
    });
    expect(submitted.terminate).toBe(true);
    expect(outcome).toEqual({
      status: "complete",
      answer: "grounded",
      cited: [FIXTURE_PUBLICATION_ID]
    });
  });

  it("rejects an answer until the agent reads a cited publication", async () => {
    let outcome: AnswerOutcome | undefined;
    const submit = createAnswerTools(env, (next) => {
      outcome = next;
    }).find(({ name }) => name === "submit_answer") as AgentTool | undefined;
    if (!submit) throw new Error("missing submit_answer");
    const result = await submit.execute("test", {
      answer: "ungrounded",
      cited_publication_ids: [FIXTURE_PUBLICATION_ID]
    });
    expect(result.terminate).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain("read and cite");
    expect(outcome).toBeUndefined();
  });

  it("rejects a citation revoked after it was read", async () => {
    let outcome: AnswerOutcome | undefined;
    const tools = createAnswerTools(env, (next) => {
      outcome = next;
    });
    const view = tools.find(({ name }) => name === "memory_view") as AgentTool;
    const submit = tools.find(({ name }) => name === "submit_answer") as AgentTool;
    await view.execute("test", { public_id: FIXTURE_PUBLICATION_ID });
    await env.LORE_DB.prepare("DELETE FROM publications WHERE public_id=?1")
      .bind(FIXTURE_PUBLICATION_ID)
      .run();
    const result = await submit.execute("test", {
      answer: "stale",
      cited_publication_ids: [FIXTURE_PUBLICATION_ID]
    });
    expect(result.terminate).toBeUndefined();
    expect(outcome).toBeUndefined();
  });
});
