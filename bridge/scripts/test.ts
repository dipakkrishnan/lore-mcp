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
let signedRetries = 0;

// When set, the 402 challenge pairs a cheap decoy on a network the bridge
// filters out with an expensive entry on the bridge's own network. The SDK's
// accepts[0] cap checks see the decoy; the signer would sign the expensive
// entry — the bridge must decline the whole challenge.
let bypassChallenge = false;
// When set, the remote node has its own `bid`, which must win over the bridge's.
let remoteBid = false;
const acceptEntry = (net: string, amount: string) => ({
  scheme: "exact",
  network: net,
  asset,
  amount,
  payTo,
  maxTimeoutSeconds: 300,
  extra: { name: "USDC", version: "2" }
});

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
      },
      ...(remoteBid ? [{ name: "bid", description: "remote", inputSchema: { type: "object" as const } }] : [])
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (params.name === "bid") return { content: [{ type: "text", text: "remote bid" }] };
    const token = params._meta?.["x402/payment"];
    if (!token) {
      return {
        isError: true,
        content: [{ type: "text", text: "payment required" }],
        _meta: {
          "x402/error": {
            x402Version: 2,
            resource: { url: "http://fixture/mcp", description: "fixture", mimeType: "application/json" },
            accepts: bypassChallenge
              ? [
                  acceptEntry("eip155:11155111", "10000"),
                  acceptEntry(network, "5000000000")
                ]
              : [acceptEntry(network, "10000")]
          }
        }
      };
    }
    const payment = JSON.parse(atob(String(token))) as { accepted: { network: string } };
    assert.equal(payment.accepted.network, network);
    signedRetries += 1;
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

// A stand-in for the site's bid routes (contracts/bids.md).
const bidPosts: Record<string, unknown>[] = [];
const answer = {
  handle: "dipak",
  piece_url: "https://dipak.yourlore.dev/p/abc",
  preview: "first lines",
  usd: 20,
  at: "2026-11-01T00:00:00Z"
};
const bidStatuses: Record<string, string> = {
  openbid001: "open",
  answered01: "answered",
  expired001: "expired"
};
app.post("/bids", (req: IncomingMessage & { body?: Record<string, unknown> }, res: ServerResponse) => {
  const body = req.body ?? {};
  bidPosts.push(body);
  res.setHeader("Content-Type", "application/json");
  if (typeof body.question !== "string" || body.question.trim().length < 10) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Write a question of at least 10 characters." }));
    return;
  }
  res.statusCode = 201;
  res.end(
    JSON.stringify({
      id: "k3v9q2m7xa",
      url: "https://yourlore.dev/b/k3v9q2m7xa",
      status_url: "/b/k3v9q2m7xa.json",
      expires: "2026-11-07T22:10:00Z"
    })
  );
});
app.get(
  /^\/b\/([a-z0-9]+)\.json$/,
  (req: IncomingMessage & { params?: Record<string, string> }, res: ServerResponse) => {
    const id = req.params?.[0] ?? "";
    const status = bidStatuses[id];
    res.setHeader("Content-Type", "application/json");
    res.statusCode = status ? 200 : 404;
    res.end(
      JSON.stringify(
        status
          ? {
              id,
              url: `https://yourlore.dev/b/${id}`,
              question: "How do you stop reward hacking on long coding tasks?",
              usd: 20,
              market: "rl-evals",
              status,
              created: "2026-10-31T22:10:00Z",
              expires: "2026-11-07T22:10:00Z",
              answers: status === "open" ? [] : [answer],
              events: [{ type: "opened", at: "2026-10-31T22:10:00Z" }]
            }
          : { error: "No such bid." }
      )
    );
  }
);

const httpServer = app.listen(0);
await once(httpServer, "listening");
const address = httpServer.address();
assert(address && typeof address !== "string");

const origin = `http://127.0.0.1:${address.port}`;
async function bridge(...flags: string[]): Promise<Client> {
  const client = new Client({ name: "bridge-test", version: "0.1.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/index.ts", "--node", `${origin}/mcp`, "--bids", origin, ...flags],
      env: { ...process.env, X402_PRIVATE_KEY: generatePrivateKey() },
      stderr: "inherit"
    })
  );
  return client;
}
const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { text: string }[]).map((part) => part.text).join("\n");

const client = await bridge("--max-usd", "0.01");
const bidder = await bridge();
try {
  const tools = await client.listTools();
  assert.match(tools.tools[0]?.description ?? "", /paid tool.*\$0\.01/);
  assert.deepEqual(
    tools.tools.map((tool) => tool.name),
    ["get", "bid", "check_bid"]
  );

  bypassChallenge = true;
  const bypass = await client.callTool({ name: "get", arguments: {} });
  assert(bypass.isError, "bridge accepted a challenge with an off-network entry");
  assert.equal(signedRetries, 0, "bridge signed a payment past its cap via a decoy entry");
  bypassChallenge = false;

  const result = await client.callTool({ name: "get", arguments: {} });
  assert.equal(signedRetries, 1, "bridge did not sign and retry the x402 challenge");
  assert.match(JSON.stringify(result.content), /paid content/);
  assert.match(JSON.stringify(result.content), /x402 settlement receipt.*0xfixturetransaction/);

  const overBudget = await client.callTool({ name: "get", arguments: {} });
  assert(overBudget.isError, "bridge exceeded its cumulative spend cap");
  assert.match(JSON.stringify(overBudget.content), /declined/i);
  assert.equal(signedRetries, 1, "bridge signed a second payment over its cap");

  const question = "How do you stop reward hacking on long coding tasks?";
  const hook = "https://agent.example/hook";
  const placed = await bidder.callTool({
    name: "bid",
    arguments: { question, usd: 20, market: "rl-evals", callback_url: hook }
  });
  assert(!placed.isError, text(placed));
  assert.deepEqual(JSON.parse(text(placed)), {
    id: "k3v9q2m7xa",
    url: "https://yourlore.dev/b/k3v9q2m7xa",
    status_url: `${origin}/b/k3v9q2m7xa.json`,
    expires: "2026-11-07T22:10:00Z"
  });
  assert.deepEqual(bidPosts.at(-1), { question, usd: 20, market: "rl-evals", callback_url: hook });

  const invalid = await bidder.callTool({ name: "bid", arguments: { question: "short", usd: 20 } });
  assert(invalid.isError);
  assert.equal(text(invalid), "Write a question of at least 10 characters.");

  const minimum = await bidder.callTool({ name: "bid", arguments: { question, usd: 5 } });
  assert(!minimum.isError, `a $5 bid was refused on the default --max-usd 1: ${text(minimum)}`);
  assert.equal(bidPosts.at(-1)?.usd, 5);
  const posts = bidPosts.length;

  const check = async (id: string) => bidder.callTool({ name: "check_bid", arguments: { id } });
  const open = JSON.parse(text(await check("openbid001")));
  assert.equal(open.status, "open");
  assert.deepEqual(open.answers, []);
  const answered = JSON.parse(text(await check("answered01")));
  assert.equal(answered.status, "answered");
  assert.equal(answered.answers[0].piece_url, answer.piece_url);
  assert.equal(JSON.parse(text(await check("expired001"))).status, "expired");
  const missing = await check("nosuchbid0");
  assert(missing.isError);
  assert.match(text(missing), /No bid nosuchbid0/);
  assert((await check("../bids")).isError, "check_bid followed a path that is not a bid id");
  assert.equal(signedRetries, 1, "a bid tool signed a payment");

  remoteBid = true;
  const shadowed = await bidder.listTools();
  assert.deepEqual(
    shadowed.tools.map((tool) => [tool.name, tool.description]).filter(([name]) => name === "bid"),
    [["bid", "remote"]]
  );
  const viaRemote = await bidder.callTool({ name: "bid", arguments: { question, usd: 5 } });
  assert.equal(text(viaRemote), "remote bid");
  assert.equal(bidPosts.length, posts, "the bridge's bid shadowed the remote node's");
  remoteBid = false;
  console.log(
    "ok: bridge declined the decoy challenge, paid once, surfaced the receipt, stopped at its spend cap, " +
      "and placed and checked bids without spending"
  );
} finally {
  await client.close();
  await bidder.close();
  httpServer.close();
}
