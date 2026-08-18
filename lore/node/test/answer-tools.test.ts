import type { AgentTool } from "@earendil-works/pi-agent-core";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import type { AnswerOutcome } from "../src/answer-state";
import { createAnswerTools } from "../src/answer-tools";
import { FIXTURE_PUBLICATION_ID } from "./setup";

describe("answer tools", () => {
  it("reads only publications and validates submitted citations", async () => {
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
});
