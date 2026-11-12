import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { type AnswerOutcome, validPublicId } from "./answer-state.js";

async function validCitations(env: Env, viewed: Set<string>, cited: string[]) {
  const candidates = [...new Set(cited)].filter(
    (id) => validPublicId(id) && viewed.has(id)
  );
  if (!candidates.length) return [];
  const placeholders = candidates.map((_, index) => `?${index + 1}`).join(",");
  const { results } = await env.LORE_DB.prepare(
    `SELECT public_id FROM publications WHERE public_id IN (${placeholders})`
  )
    .bind(...candidates)
    .all<{ public_id: string }>();
  const active = new Set(results.map(({ public_id }) => public_id));
  return candidates.filter((id) => active.has(id));
}

export const MAX_SEARCH_TERMS = 8;
/** D1 rejects a LIKE pattern longer than this many bytes ("LIKE or GLOB pattern too complex"). */
export const MAX_PATTERN_BYTES = 50;

const LIKE_SPECIAL = /[\\%_]/;

function utf8Length(codePoint: number) {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** The longest prefix of `term`, by whole code points, whose likePattern fits D1's limit. */
function fitPattern(term: string) {
  let kept = "";
  let bytes = 2; // the leading and trailing %
  for (const char of term) {
    const size = utf8Length(char.codePointAt(0) ?? 0) + (LIKE_SPECIAL.test(char) ? 1 : 0);
    if (bytes + size > MAX_PATTERN_BYTES) break;
    kept += char;
    bytes += size;
  }
  return kept;
}

/**
 * Whitespace-separated words of a search: at most MAX_SEARCH_TERMS of them, each
 * cut (by whole code points) so its escaped LIKE pattern fits MAX_PATTERN_BYTES.
 */
export function searchTerms(query: string): string[] {
  return query.trim().split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS).map(fitPattern);
}

/** A LIKE pattern matching `term` literally anywhere, for use with ESCAPE '\\'. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function createAnswerTools(
  env: Env,
  finish: (outcome: AnswerOutcome) => void,
  viewed = new Set<string>()
) {
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
      if (row) viewed.add(public_id);
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
    description:
      "Search publication titles, teasers, topics, and content. Every word must appear; word order does not matter.",
    parameters: searchParameters,
    async execute(_callId, { query }) {
      const terms = searchTerms(query);
      if (!terms.length) return { content: [{ type: "text", text: "[]" }], details: {} };
      const where = terms
        .map((_, index) => {
          const n = `?${index + 1}`;
          return `(${["title", "teaser", "content", "topic"]
            .map((column) => `${column} LIKE ${n} ESCAPE '\\'`)
            .join(" OR ")})`;
        })
        .join(" AND ");
      const { results } = await env.LORE_DB.prepare(
        `SELECT public_id AS id, title, teaser, topic FROM publications WHERE ${where} LIMIT 8`
      )
        .bind(...terms.map(likePattern))
        .all();
      return { content: [{ type: "text", text: JSON.stringify(results) }], details: {} };
    }
  };

  const submitParameters = Type.Object(
    {
      answer: Type.String({ minLength: 1 }),
      cited_publication_ids: Type.Array(Type.String(), { minItems: 1 })
    },
    { additionalProperties: false }
  );
  const submitAnswer: AgentTool<typeof submitParameters> = {
    name: "submit_answer",
    label: "Submit answer",
    description: "Deliver a grounded final answer and every publication id it uses.",
    parameters: submitParameters,
    async execute(_callId, { answer, cited_publication_ids }) {
      const cited = await validCitations(env, viewed, cited_publication_ids);
      if (!cited.length) {
        return {
          content: [
            { type: "text", text: "read and cite at least one publication before submitting" }
          ],
          details: {}
        };
      }
      finish({
        status: "complete",
        answer,
        cited
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
