import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { AnswerOutcome } from "./answer-state.js";
import { validPublicId } from "./answer-state.js";

async function validCitations(env: Env, cited: string[]): Promise<string[]> {
  const candidates = [...new Set(cited.filter(validPublicId))];
  if (!candidates.length) return [];
  const placeholders = candidates.map((_, index) => `?${index + 1}`).join(",");
  const { results } = await env.LORE_DB.prepare(
    `SELECT public_id FROM publications WHERE public_id IN (${placeholders})`
  )
    .bind(...candidates)
    .all<{ public_id: string }>();
  return results.map(({ public_id }) => public_id);
}

export function createAnswerTools(env: Env, finish: (outcome: AnswerOutcome) => void) {
  const viewParameters = Type.Object(
    { public_id: Type.String() },
    { additionalProperties: false }
  );
  const memoryView: AgentTool<typeof viewParameters> = {
    name: "memory_view",
    label: "Read publication",
    description: "Read one publication by a public_id from available_publications.",
    parameters: viewParameters,
    async execute(_callId, { public_id }) {
      if (!validPublicId(public_id)) {
        return { content: [{ type: "text", text: "invalid publication id" }], details: {} };
      }
      const row = await env.LORE_DB.prepare(
        "SELECT public_id AS id, title, content, topic, kind FROM publications WHERE public_id = ?1"
      )
        .bind(public_id)
        .first();
      return {
        content: [{ type: "text", text: JSON.stringify(row ?? { error: "publication not found" }) }],
        details: {}
      };
    }
  };

  const searchParameters = Type.Object(
    { query: Type.String({ minLength: 1 }) },
    { additionalProperties: false }
  );
  const memorySearch: AgentTool<typeof searchParameters> = {
    name: "memory_search",
    label: "Search publications",
    description: "Search publication titles, teasers, topics, and content for words.",
    parameters: searchParameters,
    async execute(_callId, { query }) {
      const needle = `%${query.replace(/[%_]/g, " ")}%`;
      const { results } = await env.LORE_DB.prepare(
        `SELECT public_id AS id, title, teaser, topic FROM publications
         WHERE title LIKE ?1 OR teaser LIKE ?1 OR content LIKE ?1 OR topic LIKE ?1 LIMIT 8`
      )
        .bind(needle)
        .all();
      return { content: [{ type: "text", text: JSON.stringify(results) }], details: {} };
    }
  };

  const submitParameters = Type.Object(
    {
      answer: Type.String({ minLength: 1 }),
      cited_publication_ids: Type.Array(Type.String())
    },
    { additionalProperties: false }
  );
  const submitAnswer: AgentTool<typeof submitParameters> = {
    name: "submit_answer",
    label: "Submit answer",
    description: "Deliver a grounded final answer and every publication id it uses.",
    parameters: submitParameters,
    async execute(_callId, { answer, cited_publication_ids }) {
      finish({
        status: "complete",
        answer,
        cited: await validCitations(env, cited_publication_ids)
      });
      return { content: [{ type: "text", text: "answer accepted" }], details: {}, terminate: true };
    }
  };

  const refuseParameters = Type.Object(
    { reason: Type.String({ minLength: 1 }) },
    { additionalProperties: false }
  );
  const refuse: AgentTool<typeof refuseParameters> = {
    name: "refuse",
    label: "Refuse",
    description: "Decline when the publications do not cover the question.",
    parameters: refuseParameters,
    async execute(_callId, { reason }) {
      finish({ status: "refused", reason });
      return { content: [{ type: "text", text: "refusal accepted" }], details: {}, terminate: true };
    }
  };

  return [memoryView, memorySearch, submitAnswer, refuse];
}
