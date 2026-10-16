import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { Inbox, LIMITS, failed } from "./inbox.js";

/**
 * The owner's own agents' endpoint, `/agent` (XC-067, contracts/inbox.md):
 * stateless MCP behind an agent key, apart from the buyer `/mcp`, so buyers
 * never see these tools and nothing here touches payment.
 */

const TOKEN = /^lore_agent_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;
const MCP_BODY_BYTES = 5_242_880;

const INSTRUCTIONS =
  "This is your owner's Lore, where their context lives: their experiences, lessons, preferences and facts. " +
  "Use `store` to save what you learn about them. Lore keeps every save private on the owner's Mac until the owner reviews it in the Lore app, " +
  "and nothing is ever published or sold without the owner's approval. " +
  "Give each memory a stable `key` and save again under it when it changes; use `stored` to tell the owner what reached Lore, and `forget` to take something back.";

function chars(field: string, min: number, max: number, base = z.string()) {
  const message = min ? `${field} must be ${min}–${max.toLocaleString("en-US")} characters` : `${field} must be at most ${max} characters`;
  return base.refine((value) => [...value].length >= min && [...value].length <= max, message);
}

const key = chars("key", 1, 120, z.string().trim());

const Save = z.object({
  title: chars("title", 1, 200).describe("A short, specific title, up to 200 characters."),
  content: chars("content", 1, 20_000).describe(
    "The memory itself, in the owner's own terms: what happened, what they learned or prefer, and why. Up to 20,000 characters."
  ),
  topic: chars("topic", 0, 80).nullish().describe("A few words naming the subject, up to 80 characters."),
  kind: z.enum(["experience", "lesson", "preference", "fact", "reference"]).nullish().describe("What sort of memory this is."),
  key: key
    .nullish()
    .describe("Your own stable name for this memory, up to 120 characters. Saving again under the same key replaces the earlier version, so use it to keep context current."),
  occurred_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/, "occurred_at must be an ISO 8601 date")
    .nullish()
    .describe("When it happened, as an ISO 8601 date, if known.")
});

function reply(result: object) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }], isError: failed(result) || undefined };
}

function server(inbox: Inbox): McpServer {
  const server = new McpServer({ name: "Lore agent inbox", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  server.registerTool(
    "store",
    {
      description:
        "Save 1–20 memories about your owner into their private Lore. Write each one so it stands on its own: a clear title and the substance in the content. " +
        "Saving again under the same key replaces the earlier version. Nothing is published or sold without the owner's approval.",
      inputSchema: { items: z.array(Save).min(1, "store takes 1–20 items").max(LIMITS.items, "store takes 1–20 items") }
    },
    async ({ items }) => reply(await inbox.store(items))
  );
  server.registerTool(
    "stored",
    {
      description:
        "Check what you have saved to your owner's Lore: your totals, and the latest state of each key you name (waiting, received by their Mac, forgotten, or unknown).",
      inputSchema: { keys: z.array(key).max(LIMITS.keys, `stored takes at most ${LIMITS.keys} keys`).optional() }
    },
    async ({ keys }) => reply(await inbox.stored(keys))
  );
  server.registerTool(
    "forget",
    {
      description: "Take back a memory you saved under this key. If the owner's Mac already has it, the Mac removes it on its next collection.",
      inputSchema: { key }
    },
    async ({ key }) => reply(await inbox.forget(key))
  );
  return server;
}

export async function serveAgent(request: Request, env: Env): Promise<Response> {
  const origin = new URL(request.url).origin;
  const [, id, secret] = TOKEN.exec(request.headers.get("authorization")?.replace(/^Bearer /i, "") ?? "") ?? [];
  const inbox = id ? await Inbox.open(env.LORE_DB, id, secret) : null;
  if (!inbox) {
    return Response.json(
      { error: "a valid Lore agent key is required" },
      { status: 401, headers: { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` } }
    );
  }
  if (request.method !== "POST") return Response.json({ error: "method not allowed" }, { status: 405, headers: { Allow: "POST" } });
  const body = await request.arrayBuffer();
  if (body.byteLength > MCP_BODY_BYTES) return Response.json({ error: "request body too large" }, { status: 413 });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server(inbox).connect(transport);
  return transport.handleRequest(new Request(request, { body }));
}
