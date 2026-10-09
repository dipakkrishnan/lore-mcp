/** Feeds (MON-045): one payment buys a 30-day pass to every piece in the store, old and new.
 * The pass is a bearer token kept in this node's own table; a push never touches it. */
import type { RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { paying } from "./free.js";
import { toolSpanAttributes } from "./telemetry.js";
import { withSpan } from "./tracing.js";

export const FEED_DAYS = 30;
const PASS = /^pass_[0-9a-f]{32}$/;

async function ensureFeedSchema(db: D1Database): Promise<void> {
  await db
    .prepare("CREATE TABLE IF NOT EXISTS feed_passes (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL)")
    .run();
}

/** A new pass, good for `FEED_DAYS` from now. */
export async function mintPass(db: D1Database): Promise<{ pass: string; expires_at: string }> {
  await ensureFeedSchema(db);
  const now = new Date();
  const pass = `pass_${crypto.randomUUID().replaceAll("-", "")}`;
  const expires_at = new Date(now.getTime() + FEED_DAYS * 86_400_000).toISOString();
  await db.prepare("INSERT INTO feed_passes(token,expires_at,created_at) VALUES (?1,?2,?3)").bind(pass, expires_at, now.toISOString()).run();
  return { pass, expires_at };
}

/** Whether a pass exists and hasn't run out; anything malformed is simply no pass. */
export async function validPass(db: D1Database, pass: unknown): Promise<boolean> {
  if (typeof pass !== "string" || !PASS.test(pass)) return false;
  await ensureFeedSchema(db);
  const found = await db
    .prepare("SELECT 1 FROM feed_passes WHERE token = ?1 AND expires_at > ?2")
    .bind(pass, new Date().toISOString())
    .first();
  return found !== null;
}

type Publication = { id: string; title: string };
type Handler = (args: { id: string; pass?: string }, extra: Parameters<ToolCallback>[0]) => Promise<CallToolResult>;

/** Let `get` deliver to a pass holder before free copies or x402 are asked. A paying call, or one
 * without a valid pass, reaches the tool unchanged. */
export function passFirst(
  db: D1Database,
  tool: RegisteredTool,
  find: (id: string) => Promise<Publication | null>,
  deliver: (publication: Publication) => CallToolResult
): void {
  const next = tool.handler as Handler;
  const callback: Handler = async (args, extra) => {
    if (paying(extra) || !(await validPass(db, args.pass))) return next(args, extra);
    const found = await find(args.id);
    if (!found) return next(args, extra);
    return withSpan("lore.get", (setAttributes) => {
      setAttributes(() => toolSpanAttributes({ tool: "get", outcome: "ok", paid: false, itemId: found.id }));
      return deliver(found);
    });
  };
  tool.update({ callback: callback as NonNullable<Parameters<RegisteredTool["update"]>[0]["callback"]> });
}
