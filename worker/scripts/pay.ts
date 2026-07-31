import assert from "node:assert/strict";
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

const query = "What is Lore?";

// Read the first text block of a tool result as JSON.
function payload(result: unknown): Record<string, unknown> {
  const blocks = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  const text = blocks.find((block) => block.type === "text")?.text;
  assert.ok(text, "expected a text block in the tool result");
  return JSON.parse(text) as Record<string, unknown>;
}

function titles(rows: unknown): string[] {
  return (rows as { title: string }[]).map(({ title }) => title).sort();
}

try {
  // The free advertisement for the same question, taken before paying.
  const advertised = payload(
    await client.callTool({ name: "discover", arguments: { query } })
  );

  // null selects withX402Client's default payment-approval callback.
  const result = await paidClient.callTool(null, {
    name: "answer",
    arguments: { query }
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.isError) {
    process.exitCode = 1;
  } else {
    // Invariant: payment never widens the disclosable set.
    //
    // Free and paid differ in *depth* on purpose — discover returns titles and
    // topics, answer returns the content. They must not differ in *breadth*.
    // Paying buys the content of rows the node already advertised; if it ever
    // surfaced a row discover would not have named, payment would have become a
    // disclosure decision, which is the one thing it must never be.
    assert.deepEqual(
      titles(payload(result).answer_context),
      titles(advertised.matches),
      "the paid answer returned rows that discover did not advertise, so payment " +
        "widened what is disclosable rather than only unlocking its content"
    );
    console.log("payment did not widen the disclosable set: ok");
  }
} finally {
  await client.close();
}
