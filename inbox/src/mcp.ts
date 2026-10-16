import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { failed } from "./http.js";
import type { Inbox } from "./inbox.js";
import { LIMITS, Save, key } from "./limits.js";

const INSTRUCTIONS =
  "Lore keeps your owner's context: their experiences, lessons, preferences and facts. " +
  "Use `store` to save what you learn about them, so it reaches their Lore library on their Mac. " +
  "Lore keeps every save private until the owner reviews it in the Lore app, and nothing is ever published or sold without the owner's approval. " +
  "Give each memory a stable `key` and save again under it when it changes; use `stored` to tell the owner what reached Lore, and `forget` to take something back.";

function reply(result: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(failed(result) ? { error: result.error } : result) }],
    isError: failed(result) || undefined
  };
}

/** A fresh stateless MCP server for one request from the agent holding `secret`. */
function server(inbox: DurableObjectStub<Inbox>, secret: string): McpServer {
  const server = new McpServer({ name: "Lore inbox", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  server.registerTool(
    "store",
    {
      description:
        "Save 1–20 memories about your owner into their private Lore inbox. Write each one so it stands on its own: a clear title and the substance in the content. " +
        "Saving again under the same key replaces the earlier version while it waits. Nothing is published or sold without the owner's approval.",
      inputSchema: { items: z.array(Save).min(1, "store takes 1–20 items").max(LIMITS.items, "store takes 1–20 items") }
    },
    async ({ items }) => reply(await inbox.store(secret, items))
  );
  server.registerTool(
    "stored",
    {
      description:
        "Check what you have saved to your owner's Lore: your totals, and the latest state of each key you name (waiting, received by their Mac, forgotten, or unknown).",
      inputSchema: { keys: z.array(key).max(LIMITS.keys, `stored takes at most ${LIMITS.keys} keys`).optional() }
    },
    async ({ keys }) => reply(await inbox.stored(secret, keys))
  );
  server.registerTool(
    "forget",
    {
      description: "Take back a memory you saved under this key. If the owner's Mac already has it, the Mac removes it on its next collection.",
      inputSchema: { key }
    },
    async ({ key }) => reply(await inbox.forget(secret, key))
  );
  return server;
}

export async function serve(request: Request, inbox: DurableObjectStub<Inbox>, secret: string): Promise<Response> {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server(inbox, secret).connect(transport);
  return transport.handleRequest(request);
}
