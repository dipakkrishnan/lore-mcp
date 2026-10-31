// Stdio MCP server that fronts one remote x402-paid MCP server. Tools pass
// through unchanged; when the remote answers "payment required", the wrapped
// client signs and retries. The key never enters the model's context — the
// client only ever sees tool results.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult
} from "@modelcontextprotocol/sdk/types.js";
import { toClientEvmSigner } from "@x402/evm";
import { withX402Client } from "agents/x402";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  approve,
  bridgeKey,
  decodeReceipt,
  parseBridgeArgs,
  UsageError,
  type BridgeArgs
} from "./policy.js";

// Every log line goes to stderr as JSON — stdout belongs to the MCP transport.
// This stream is also the demo's live payment feed: `tail -f` the bridge's
// stderr and you watch challenge → paid → receipt as it happens.
function emit(event: string, data: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ event, ...data })}\n`);
}

let args: BridgeArgs;
try {
  args = parseBridgeArgs(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof UsageError)) throw err;
  console.error(err.message);
  process.exit(1);
}
const { maxUsd, maxPaymentValue } = args;
let authorizedPaymentValue = 0n;

const account = privateKeyToAccount(bridgeKey(generatePrivateKey));
emit("startup", {
  node: args.node,
  network: args.network,
  maxUsd,
  buyer: account.address
});

const remote = new Client({ name: "x402-mcp-bridge", version: "0.1.0" });
await remote.connect(new StreamableHTTPClientTransport(new URL(args.node)));

const paid = withX402Client(remote, {
  account: toClientEvmSigner(account),
  network: args.network,
  // USDC has 6 decimals. The SDK enforces this per call; the callback below
  // reserves against the same cap across the lifetime of this process.
  maxPaymentValue,
  confirmationCallback: async (accepts) => {
    const decision = approve(accepts, args.network, authorizedPaymentValue, maxPaymentValue);
    if (!decision.approved) {
      if (decision.reason === "option") {
        emit("declined", { reason: `unacceptable payment option: ${decision.detail}`, accepts });
      } else {
        emit("declined", {
          reason: "cumulative spend cap",
          amount: decision.amount.toString(),
          authorized: authorizedPaymentValue.toString(),
          cap: maxPaymentValue.toString()
        });
      }
      return false;
    }
    authorizedPaymentValue += decision.amount;
    emit("challenge", { accepts });
    return true;
  }
});

const server = new Server(
  { name: "x402-mcp-bridge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  // The wrapper annotates paid tools' descriptions with their price, so the
  // model can weigh cost before calling.
  return paid.listTools();
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  emit("call", { tool: request.params.name });
  const result = (await paid.callTool(null, request.params)) as CallToolResult;
  const receipt = decodeReceipt(result._meta?.["x402/payment-response"]);
  if (receipt) {
    emit("settled", { tool: request.params.name, receipt });
    // Surface settlement in the conversation itself, not just this log.
    result.content = [
      ...(result.content ?? []),
      { type: "text", text: `x402 settlement receipt: ${JSON.stringify(receipt)}` }
    ];
  }
  return result;
});

await server.connect(new StdioServerTransport());
emit("ready", {});
