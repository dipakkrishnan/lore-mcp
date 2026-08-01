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

interface NodeRow {
  id: number;
  parent_id: number | null;
  title: string;
  description: string;
  position: number;
}

interface TreeBranch {
  title: string;
  description: string;
  publication_count: number;
  last_updated: string | null;
  children: TreeBranch[];
}

// Mirrors Store.public_tree() at the origin: every edge row is an active
// publication, so the manifest is plain bottom-up rollups over what
// `lore push` rendered. Returns an empty catalog if the mirror predates the
// nodes table, so an un-pushed deploy degrades instead of failing discover.
async function buildTree(env: Env): Promise<TreeBranch[]> {
  let nodes: NodeRow[];
  let stats: { node_id: number; count: number; last_updated: string | null }[];
  try {
    nodes = (
      await env.LORE_DB.prepare(
        "SELECT id, parent_id, title, description, position FROM nodes ORDER BY position, id"
      ).all<NodeRow>()
    ).results;
    stats = (
      await env.LORE_DB.prepare(
        `SELECT node_id, COUNT(*) AS count, MAX(updated_at) AS last_updated
         FROM publications WHERE node_id IS NOT NULL GROUP BY node_id`
      ).all<{ node_id: number; count: number; last_updated: string | null }>()
    ).results;
  } catch {
    return [];
  }
  const byNode = new Map(stats.map((row) => [row.node_id, row]));
  const children = new Map<number | null, NodeRow[]>();
  for (const node of nodes) {
    const siblings = children.get(node.parent_id) ?? [];
    siblings.push(node);
    children.set(node.parent_id, siblings);
  }
  const build = (parentId: number | null): TreeBranch[] =>
    (children.get(parentId) ?? []).flatMap((node) => {
      const sub = build(node.id);
      const own = byNode.get(node.id);
      let count = own?.count ?? 0;
      let lastUpdated = own?.last_updated ?? null;
      for (const child of sub) {
        count += child.publication_count;
        if (child.last_updated && (!lastUpdated || child.last_updated > lastUpdated)) {
          lastUpdated = child.last_updated;
        }
      }
      // Pushed nodes always shelter an active publication, but keep the
      // pruning rule anyway: a stale mirror must not advertise empty branches.
      if (count === 0) return [];
      return [
        {
          title: node.title,
          description: node.description,
          publication_count: count,
          last_updated: lastUpdated,
          children: sub
        }
      ];
    });
  return build(null);
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
          "Check whether this Lore node can help with a query. Also returns the node's catalog: a tree of owner-approved topic branches with per-branch publication counts and freshness.",
        inputSchema: { query: z.string().trim().min(1) }
      },
      async ({ query }) => {
        // The free surface: titles, topics, and the catalog — the
        // advertisement, never the paid content. Content is matched for
        // recall but not returned.
        const matches = await searchPublications(this.env, query, 5);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                can_help: matches.length > 0,
                matches: matches.map(({ title, topic }) => ({ title, topic })),
                tree: await buildTree(this.env),
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
