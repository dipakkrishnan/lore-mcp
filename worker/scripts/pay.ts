import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { toClientEvmSigner } from "@x402/evm";
import { withX402Client } from "agents/x402";
import { privateKeyToAccount } from "viem/accounts";
import { PRICE_USD, usdcBaseUnits } from "../src/price.js";

const endpoint = process.argv[2];
const privateKey = process.env.BUYER_TEST_PRIVATE_KEY;

if (!endpoint) throw new Error("usage: npm run pay -- https://<worker>/mcp");
if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey ?? "")) {
  throw new Error("BUYER_TEST_PRIVATE_KEY must be a dedicated test private key");
}

const client = new Client({ name: "lore-canary-buyer", version: "0.1.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)));

const paidClient = withX402Client(client, {
  account: toClientEvmSigner(
    privateKeyToAccount(privateKey as `0x${string}`)
  ),
  network: "eip155:84532",
  maxPaymentValue: usdcBaseUnits(PRICE_USD)
});

try {
  // null selects withX402Client's default payment-approval callback.
  const result = await paidClient.callTool(null, {
    name: "answer",
    arguments: { query: "What is Lore?" }
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) process.exitCode = 1;
} finally {
  await client.close();
}
