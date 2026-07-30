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

// ponytail: paidTool still targets legacy McpAgent; migrate when Cloudflare
// supports x402 on its recommended stateless createMcpHandler path.
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
        description: "Check whether this test Lore node can help.",
        inputSchema: { query: z.string().trim().min(1) }
      },
      async () => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              can_help: true,
              price_usd: PRICE_USD,
              disclosure: "Canary data only; no private Lore is connected."
            })
          }
        ]
      })
    );

    this.server.paidTool(
      "answer",
      "Return the hardcoded Lore payment canary answer.",
      PRICE_USD,
      { query: z.string().trim().min(1) },
      {}, // paidTool's output schema; the canary returns unstructured text only.
      async () => ({
        content: [
          {
            type: "text",
            text: "Lore turns owner-approved context into paid agent answers."
          }
        ]
      })
    );
  }
}

export default LorePaidMCP.serve("/mcp", { binding: "LorePaidMCP" });
