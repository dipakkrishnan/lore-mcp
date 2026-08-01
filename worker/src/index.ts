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

// The D1 table `lore push` maintains. Rows here are owner-approved publications
// and nothing else — no private data exists at the edge to leak.
async function searchPublications(
  env: Env,
  query: string,
  limit: number
): Promise<PublicationRow[]> {
  const like = `%${query.replaceAll(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const { results } = await env.LORE_DB.prepare(
    `SELECT title, content, topic FROM publications
     WHERE title LIKE ?1 ESCAPE '\\' OR topic LIKE ?1 ESCAPE '\\' OR content LIKE ?1 ESCAPE '\\'
     ORDER BY id LIMIT ?2`
  )
    .bind(like, limit)
    .all<PublicationRow>();
  return results;
}

// The catalog `lore push` renders and ships as text. It is served verbatim: the
// privacy rules that decide what may appear in it live in lore/manifest.py, and
// rebuilding it here would mean restating them in a second language.
async function manifest(env: Env): Promise<string> {
  const row = await env.LORE_DB.prepare("SELECT text FROM manifest LIMIT 1").first<{
    text: string;
  }>();
  return row?.text ?? "# Lore node\n\nThis node currently offers nothing.\n";
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
        description:
          "Return this Lore node's owner-approved catalog of what it can answer. " +
          "Call with no arguments to browse everything; pass a query to also learn " +
          "which topics match it.",
        inputSchema: { query: z.string().trim().min(1).optional() }
      },
      async ({ query }) => {
        const catalog = await manifest(this.env);
        // Counted, not inferred from the catalog text: an empty node still renders
        // a valid manifest, so a non-empty string does not mean there is anything
        // to sell.
        const offered = await this.env.LORE_DB.prepare(
          "SELECT count(*) AS n FROM publications"
        ).first<{ n: number }>();
        // Topics, never titles. A claim's title is usually the claim itself, so
        // naming it here would give away for free exactly what `answer` sells.
        const relevant = query
          ? [...new Set((await searchPublications(this.env, query, 50)).map((r) => r.topic))]
          : undefined;
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                can_help: (offered?.n ?? 0) > 0,
                manifest: catalog,
                ...(relevant ? { relevant_topics: relevant.sort() } : {}),
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
