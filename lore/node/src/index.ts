import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { withX402 } from "agents/x402";
import { z } from "zod";
import { PRICE_USD } from "./price.js";

function payTo(env: Env): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.LORE_WALLET ?? "")) {
    throw new Error("LORE_WALLET must be a public EVM address");
  }
  return env.LORE_WALLET as `0x${string}`;
}

interface PublicationRow {
  title: string;
  content: string;
  topic: string;
}

// Mirrors lore/store.py's search_publications: buyers ask in sentences, so a
// single %whole-sentence% substring can never match — and past ~10 words D1
// rejects the pattern outright. Match OR over meaningful word tokens instead,
// ranked by how many terms hit.
const QUERY_STOPWORDS = new Set(
  ("a about an and are can could do does for has have how i is it me of on or " +
    "person tell that the this to what when where who why with you your").split(" ")
);

function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const terms = words
    .filter((word) => !QUERY_STOPWORDS.has(word))
    // Crude singularization ("launches" → "launch"); safe because matching is
    // substring, so an over-stripped stem still hits the full word.
    .map((word) =>
      word.length >= 4 && word.endsWith("es")
        ? word.slice(0, -2)
        : word.length >= 4 && word.endsWith("s")
          ? word.slice(0, -1)
          : word
    );
  // ponytail: cap at 8 terms — bounds the SQL, and more terms than that add
  // recall a five-row LIMIT can't use anyway.
  return [...new Set(terms)].slice(0, 8);
}

// The D1 table `lore push` maintains. Rows here are owner-approved publications
// and nothing else — no private data exists at the edge to leak.
async function searchPublications(
  env: Env,
  query: string,
  limit: number
): Promise<PublicationRow[]> {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  // Tokens are \w+ only, so no LIKE metacharacters need escaping.
  const hit = (i: number) =>
    `(title LIKE ?${i + 1} OR topic LIKE ?${i + 1} OR content LIKE ?${i + 1})`;
  const score = terms.map((_, i) => hit(i)).join(" + ");
  const { results } = await env.LORE_DB.prepare(
    `SELECT title, content, topic FROM publications
     WHERE ${terms.map((_, i) => hit(i)).join(" OR ")}
     ORDER BY (${score}) DESC, id LIMIT ?${terms.length + 1}`
  )
    .bind(...terms.map((term) => `%${term}%`), limit)
    .all<PublicationRow>();
  return results;
}

// ponytail: withX402 (which provides paidTool) only works on the legacy
// McpAgent class today; migrate when Cloudflare supports x402 on its
// recommended stateless createMcpHandler path.
export class LorePaidMCP extends McpAgent<Env> {
  server = withX402(
    new McpServer({ name: "Lore x402 canary", version: "0.1.0" }),
    {
      network: "eip155:84532",
      recipient: payTo(this.env),
      facilitator: { url: "https://x402.org/facilitator" }
    }
  );

  async init() {
    this.server.registerTool(
      "discover",
      {
        description: "Check whether this Lore node can help with a query.",
        inputSchema: { query: z.string().trim().min(1) }
      },
      async ({ query }) => {
        // The free surface: titles and topics only — the advertisement, never
        // the paid content. Content is matched for recall but not returned.
        const matches = await searchPublications(this.env, query, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                can_help: matches.length > 0,
                matches: matches.map(({ title, topic }) => ({ title, topic })),
                price_usd: PRICE_USD,
                disclosure: "Only owner-approved publications are available."
              })
            }
          ]
        };
      }
    );

    this.server.paidTool(
      "answer",
      "Return owner-approved evidence relevant to a query.",
      PRICE_USD,
      { query: z.string().trim().min(1) },
      {}, // paidTool's output schema; unstructured text only.
      async ({ query }) => {
        // Paid and free read the same rows: payment decides whether a caller
        // is served, never what is servable.
        const matches = await searchPublications(this.env, query, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                answer_context: matches.map(({ title, content, topic }) => ({
                  title,
                  content,
                  topic
                })),
                disclosure: "Only owner-approved publications are available."
              })
            }
          ]
        };
      }
    );
  }
}

export default LorePaidMCP.serve("/mcp", { binding: "LorePaidMCP" });
