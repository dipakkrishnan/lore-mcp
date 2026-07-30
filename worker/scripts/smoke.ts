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
