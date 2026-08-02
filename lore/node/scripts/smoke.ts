// Manual, unpaid health check: run `npm run smoke` against a local `npm run dev`
// server (or `npm run smoke -- <url>` against a deployed Worker) to verify the
// tools are listed, discover serves the manifest free, and get challenges for
// payment without serving content. It spends nothing and is not wired into CI —
// run it after any Worker change and after each deploy, before spending faucet
// funds on `npm run pay`.
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
    ["discover", "get"]
  );

  const discover = await client.callTool({
    name: "discover",
    arguments: {}
  });
  assert.equal(discover.isError, undefined);
  // The manifest must advertise without disclosing: teasers and topics are the
  // only text, and the payload shape matches the stdio server's discover.
  const payload = JSON.parse((discover.content as { text: string }[])[0].text);
  assert.equal(payload.manifest_version, 1);
  assert.ok(typeof payload.publication_count === "number");
  assert.ok(payload.topics && typeof payload.topics === "object");
  for (const entries of Object.values(payload.topics as Record<string, object[]>)) {
    for (const entry of entries) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ["id", "kind", "teaser", "updated_at"]
      );
    }
  }

  const get = await client.callTool({
    name: "get",
    arguments: { id: 1 }
  });
  assert.equal(get.isError, true);
  assert.ok(get._meta?.["x402/error"]);
  console.log("free discover manifest and paid get challenge: ok");
} finally {
  await client.close();
}
