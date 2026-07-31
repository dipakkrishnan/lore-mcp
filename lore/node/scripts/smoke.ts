// Manual, unpaid health check: run `npm run smoke` against a local `npm run dev`
// server (or `npm run smoke -- <url>` against a deployed Worker) to verify the
// tools are listed, discover is free, and answer challenges for payment without
// serving content. It spends nothing and is not wired into CI — run it after any
// Worker change and after each deploy, before spending faucet funds on `npm run pay`.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.argv[2] ?? "http://localhost:8787/mcp";
const client = new Client({ name: "lore-canary-smoke", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(endpoint), {
    // Fail rather than hang if the Worker stops responding.
    requestInit: { signal: AbortSignal.timeout(10_000) }
  })
);

try {
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map(({ name }) => name).sort(),
    ["answer", "discover"]
  );

  const discover = await client.callTool({
    name: "discover",
    arguments: { query: "Lore" }
  });
  assert.equal(discover.isError, undefined);

  // Buyers ask in sentences; a long natural-language query must search, not
  // error (a regression here surfaced as a D1 "pattern too complex" crash).
  const sentence = await client.callTool({
    name: "discover",
    arguments: {
      query:
        "Can this person teach me anything useful about why new product launches fail so often?"
    }
  });
  assert.equal(sentence.isError, undefined);

  const answer = await client.callTool({
    name: "answer",
    arguments: { query: "What is Lore?" }
  });
  assert.equal(answer.isError, true);
  assert.ok(answer._meta?.["x402/error"]);
  console.log("free discover and paid answer challenge: ok");
} finally {
  await client.close();
}
