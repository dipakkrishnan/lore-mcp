import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { env, exports } from "cloudflare:workers";
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

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): Record<string, unknown> {
  return JSON.parse((result.content as { text: string }[])[0].text) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("answer tier disabled (the default)", () => {
  it("blocks new answers without hiding prior results", async () => {
    mockFacilitator();
    const client = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name).sort();
      expect(names).toEqual(["answer", "discover", "get", "result"]);

      const blocked = await client.callTool({
        name: "answer",
        arguments: { question: "anything" }
      });
      expect(blocked.isError).toBe(true);
      expect(blocked._meta?.["x402/error"]).toBeUndefined();

      const now = new Date().toISOString();
      const ticket = "0000000000000000fcdb4b42";
      await env.LORE_DB.prepare(
        "INSERT INTO answer_tickets(ticket_id,question,price_usd,status,created_at,updated_at) " +
          "VALUES (?1,'question',0.25,'complete',?2,?2)"
      )
        .bind(ticket, now)
        .run();
      await env.LORE_DB.prepare(
        "INSERT INTO answers(ticket_id,answer,completed_at) VALUES (?1,'prior answer',?2)"
      )
        .bind(ticket, now)
        .run();
      const result = await client.callTool({ name: "result", arguments: { ticket } });
      expect(textOf(result)).toMatchObject({ status: "complete", answer: "prior answer" });
    } finally {
      await client.close();
    }
  });
});
