// MCP-002: the Worker's registered tools must match the cross-surface
// contract shared with the Python stdio server (lore/mcp.py). See
// tests/test_mcp_contract.py for the Python-side half of this check — each
// surface verifies itself against the same checked-in contracts/mcp_tools.json,
// so either one drifting from it fails on its own side.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
// Bundled at transform time, not read from disk at run time — the workerd
// sandbox this suite runs in (`@cloudflare/vitest-pool-workers`) has no
// access to the host filesystem.
import canonical from "../../../contracts/mcp_tools.json";

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-contract-test", version: "0.1.0" });
  const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    exports.default.fetch(input, init)) as typeof fetch;
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://worker.test/mcp"), { fetch: workerFetch })
  );
  return client;
}

describe("MCP tool contract", () => {
  it(
    "matches the contract shared with the Python stdio surface",
    async () => {
      const client = await connect();
      try {
        const { tools } = await client.listTools();
        const actual = tools
          .map((tool) => ({
            name: tool.name,
            description: tool.description,
            required: [...((tool.inputSchema.required as string[]) ?? [])].sort()
          }))
          .sort((a, b) => a.name.localeCompare(b.name));
        expect(actual).toEqual(canonical);
      } finally {
        await client.close();
      }
    },
    // A fresh Worker cold start under this pool can run past vitest's
    // default 5s, especially alongside sibling test files' own Workers.
    20_000
  );
});
