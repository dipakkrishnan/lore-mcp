import assert from "node:assert/strict";
import { once } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { generatePrivateKey } from "viem/accounts";

const network = "eip155:84532";
const asset = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const payTo = "0x000000000000000000000000000000000000dEaD";
let signedRetry = false;

function remoteServer(): Server {
  const server = new Server(
    { name: "paid-fixture", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "get",
        description: "fixture",
        inputSchema: { type: "object" },
        _meta: {
          "agents-x402/paymentRequired": true,
          "agents-x402/priceUSD": "0.01"
        }
      }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    const token = params._meta?.["x402/payment"];
    if (!token) {
      return {
        isError: true,
        content: [{ type: "text", text: "payment required" }],
        _meta: {
          "x402/error": {
            x402Version: 2,
            resource: { url: "http://fixture/mcp", description: "fixture", mimeType: "application/json" },
            accepts: [
              {
                scheme: "exact",
                network,
                asset,
                amount: "10000",
                payTo,
                maxTimeoutSeconds: 300,
                extra: { name: "USDC", version: "2" }
              }
            ]
          }
        }
      };
    }
    const payment = JSON.parse(atob(String(token))) as { accepted: { network: string } };
    assert.equal(payment.accepted.network, network);
    signedRetry = true;
    return {
      content: [{ type: "text", text: "paid content" }],
      _meta: {
        "x402/payment-response": {
          success: true,
          transaction: "0xfixturetransaction",
          network
        }
      }
    };
  });
  return server;
}

const app = createMcpExpressApp();
app.post(
  "/mcp",
  async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
  const server = remoteServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  }
);

const httpServer = app.listen(0);
await once(httpServer, "listening");
const address = httpServer.address();
assert(address && typeof address !== "string");

const client = new Client({ name: "bridge-test", version: "0.1.0" });
try {
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts", "--node", `http://127.0.0.1:${address.port}/mcp`],
      env: { ...process.env, X402_PRIVATE_KEY: generatePrivateKey() },
      stderr: "inherit"
    })
  );
  const tools = await client.listTools();
  assert.match(tools.tools[0]?.description ?? "", /paid tool.*\$0\.01/);

  const result = await client.callTool({ name: "get", arguments: {} });
  assert(signedRetry, "bridge did not sign and retry the x402 challenge");
  assert.match(JSON.stringify(result.content), /paid content/);
  assert.match(JSON.stringify(result.content), /x402 settlement receipt.*0xfixturetransaction/);
  console.log("ok: bridge signed, retried, and surfaced the settlement receipt");
} finally {
  await client.close();
  httpServer.close();
}
