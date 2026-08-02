import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { withX402 } from "agents/x402";
import { createHash } from "node:crypto";
import { z } from "zod";
import { PRICE_USD } from "./price.js";

function payTo(env: Env): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.LORE_WALLET ?? "")) {
    throw new Error("LORE_WALLET must be a public EVM address");
  }
  return env.LORE_WALLET as `0x${string}`;
}

function validPublicId(value: string): boolean {
  const body = value.slice(0, 16);
  return (
    /^[0-9a-f]{24}$/.test(value) &&
    value.slice(16) === createHash("sha256").update(body).digest("hex").slice(0, 8)
  );
}

interface ManifestRow {
  id: string;
  teaser: string;
  topic: string;
  kind: string;
  updated_at: string;
}

// The D1 table `lore push` maintains. Rows here are owner-approved publications
// and nothing else — no private data exists at the edge to leak. The manifest
// selects only the advertisement columns: what exists, never what it says. Ids
// are opaque public tokens (no sequence, so no revocation gaps) and freshness
// is truncated to the day (full timestamps reveal approval-session structure).
// Mirrors Store.manifest() in lore/store.py — the smoke script diffs the two.
async function manifest(env: Env): Promise<Record<string, unknown>> {
  const { results } = await env.LORE_DB.prepare(
    `SELECT public_id AS id, teaser, topic, kind,
            substr(updated_at, 1, 10) AS updated_at
     FROM publications WHERE teaser <> ''
     ORDER BY topic, updated_at DESC, public_id`
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
          "teasers grouped by topic, with ids, freshness, and price. Free. " +
          "Choose zero, one, multiple, or all ids; call get once per chosen id.",
        inputSchema: {}
      },
      async () => ({
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ...(await manifest(this.env)),
              price_usd: PRICE_USD,
              disclosure: "Choose any advertised ids; get buys one publication per call."
            })
          }
        ]
      })
    );

    this.server.paidTool(
      "get",
      "Fetch one owner-approved publication by its id from the discover catalog. " +
        "Each call buys exactly one publication. Damaged ids are rejected before " +
        "payment; use a current catalog because a just-revoked id can still be billed.",
      PRICE_USD,
      {
        id: z.string().trim().refine(validPublicId, {
          message: "invalid publication id; run discover again"
        })
      },
      {}, // paidTool's output schema; unstructured text only.
      async ({ id }) => {
        // Paid and free read the same rows: payment decides whether a caller
        // is served, never what is servable. One payment maps to exactly one
        // publication, chosen by the buyer from the catalog. The checksum rejects
        // damaged ids before payment; the remaining billable miss is a revocation
        // racing a recent discover, because paidTool settles before this handler.
        // ponytail: charged not-found on that race; refund or pre-check when
        // the x402 wrapper exposes a pre-settlement hook.
        const row = await this.env.LORE_DB.prepare(
          `SELECT public_id AS id, title, content, topic, kind, updated_at
           FROM publications WHERE public_id = ?1`
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
