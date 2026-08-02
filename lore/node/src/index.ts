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

interface ManifestRow {
  id: number;
  teaser: string;
  topic: string;
  kind: string;
  updated_at: string;
}

// The D1 table `lore push` maintains. Rows here are owner-approved publications
// and nothing else — no private data exists at the edge to leak. The manifest
// selects only the advertisement columns: what exists, never what it says.
// Mirrors Store.manifest() in lore/store.py — the smoke script diffs the two.
async function manifest(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.LORE_DB.prepare(
    `SELECT id, teaser, topic, kind, updated_at FROM publications
     WHERE teaser <> '' ORDER BY topic, updated_at DESC, id`
  ).all<ManifestRow>();
  const topics: Record<string, object[]> = {};
  for (const { id, teaser, topic, kind, updated_at } of results) {
    (topics[topic] ??= []).push({ id, teaser, kind, updated_at });
  }
  return { manifest_version: 1, publication_count: results.length, topics };
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
          "Return this node's full catalog of owner-approved publications: " +
          "teasers grouped by topic, with ids, freshness, and price. Free.",
        inputSchema: {}
      },
      async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ...(await manifest(this.env)),
              price_usd: PRICE_USD,
              disclosure:
                "Teasers describe what exists. Fetch content with get, one publication per call."
            })
          }
        ]
      })
    );

    this.server.paidTool(
      "get",
      "Fetch one owner-approved publication by its id from the discover catalog.",
      PRICE_USD,
      { id: z.number().int().min(1) },
      {}, // paidTool's output schema; unstructured text only.
      async ({ id }) => {
        // Paid and free read the same rows: payment decides whether a caller
        // is served, never what is servable. One payment maps to exactly one
        // publication, chosen by the buyer from the catalog.
        const row = await this.env.LORE_DB.prepare(
          `SELECT id, title, content, topic, kind, updated_at
           FROM publications WHERE id = ?1`
        )
          .bind(id)
          .first();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                row
                  ? {
                      publication: row,
                      disclosure:
                        "Content is owner-approved; preserve attribution when synthesizing."
                    }
                  : { error: `publication not found: ${id}` }
              )
            }
          ],
          isError: row ? undefined : true
        };
      }
    );
  }
}

export default LorePaidMCP.serve("/mcp", { binding: "LorePaidMCP" });
