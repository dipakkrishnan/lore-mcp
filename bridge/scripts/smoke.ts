// Spawns the bridge against a live node and drives the free path through it:
// tools/list must surface the remote tools, discover must return the catalog.
// No payment is made — the paid path is exercised by a real buy.
//   npm run smoke -- https://<host>/mcp
import assert from "node:assert";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const endpoint = process.argv[2];
if (!endpoint) {
  console.error("usage: npm run smoke -- https://<host>/mcp");
  process.exit(1);
}

const client = new Client({ name: "bridge-smoke", version: "0.1.0" });
await client.connect(
  new StdioClientTransport({
    command: "npx",
    args: ["tsx", "src/index.ts", "--node", endpoint],
    stderr: "inherit"
  })
);

try {
  const tools = await client.listTools();
  const names = tools.tools.map((t) => t.name);
  assert(names.includes("discover"), `no discover tool in ${JSON.stringify(names)}`);
  const paidTool = tools.tools.find((t) => t.description?.includes("paid tool"));
  assert(paidTool, "no tool description carries the paid-tool price annotation");

  const discover = await client.callTool({ name: "discover", arguments: {} });
  const text = (discover.content as { text: string }[])[0].text;
  assert(JSON.parse(text).topics, "discover did not return a topics catalog");

  console.log(`ok: ${names.join(", ")} proxied; paid tool: ${paidTool.name}`);
} finally {
  await client.close();
}
