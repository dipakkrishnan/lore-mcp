// The answer tier's owner opt-in, OFF — the deployed default. A node whose
// owner never ran `lore answer ... on` (or never pushed at all, so no
// node_settings table exists) keeps the contracted tool surface but refuses
// cleanly, and `answer` takes no payment: it issues no x402 challenge.
// Separate file from answer.test.ts because that file writes node_settings
// and per-test-file storage isolation is what keeps this one pristine.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockFacilitator } from "./facilitator";

async function connect(): Promise<Client> {
  const client = new Client({ name: "lore-answer-disabled-test", version: "0.1.0" });
  const workerFetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    exports.default.fetch(input, init)) as typeof fetch;
  await client.connect(
    new StreamableHTTPClientTransport(new URL("https://worker.test/mcp"), { fetch: workerFetch })
  );
  return client;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("answer tier disabled (the default)", () => {
  it("keeps the contracted surface but refuses every answer tool cleanly", async () => {
    mockFacilitator(); // any model call would be an unexpected fetch and throw
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["answer", "can_answer", "discover", "get", "result"]);

      for (const call of [
        { name: "can_answer", arguments: { question: "anything" } },
        { name: "answer", arguments: { question: "anything" } },
        { name: "result", arguments: { ticket: "0000000000000000fcdb4b42" } }
      ]) {
        const result = await client.callTool(call);
        expect(result.isError).toBe(true);
        // No x402 challenge: a disabled tier never asks for money.
        expect(result._meta?.["x402/error"]).toBeUndefined();
        expect(JSON.stringify(result)).toContain("not enabled");
      }
    } finally {
      await client.close();
    }
  });
});
