import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { withX402 } from "agents/x402";
import { z } from "zod";

const wallet = process.env.LORE_WALLET;
if (!/^0x[0-9a-fA-F]{40}$/.test(wallet ?? "")) {
  throw new Error("LORE_WALLET must be a public EVM address");
}

// ponytail: paidTool still targets legacy McpAgent; migrate when Cloudflare
// supports x402 on its recommended stateless createMcpHandler path.
export class LorePaidMCP extends McpAgent<Env> {
  server = withX402(
    new McpServer({ name: "Lore x402 canary", version: "0.1.0" }),
    {
      network: "eip155:84532",
      recipient: wallet as `0x${string}`,
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
              price_usd: 0.01,
              disclosure: "Canary data only; no private Lore is connected."
            })
          }
        ]
      })
    );

    this.server.paidTool(
      "answer",
      "Return the hardcoded Lore payment canary answer.",
      0.01,
      { query: z.string().trim().min(1) },
      {},
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
