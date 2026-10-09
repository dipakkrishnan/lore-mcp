/** Feeds (MON-045): one payment buys a 30-day pass to every piece in the store, old and new.
 * An agent's pass is tied to the wallet that paid for it: each read is signed by that wallet. A card
 * buyer's pass is their receipt, tied to the browser that first opened it. A push never touches either. */
import type { RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { verifyMessage } from "viem";
import { paying } from "./free.js";
import { toolSpanAttributes } from "./telemetry.js";
import { withSpan } from "./tracing.js";

export const FEED_DAYS = 30;
const DAY_MS = 86_400_000;
const PASS = /^pass_[0-9a-f]{32}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const SIGNATURE = /^0x[0-9a-fA-F]+$/;
/** How far a signed read may be from now, either way. */
const PROOF_WINDOW_MS = 10 * 60_000;

/** Exactly what the paying wallet signs to read `id` with `pass`. */
export const passMessage = (pass: string, id: string, signedAt: string) => `Lore pass ${pass} for ${id} at ${signedAt}`;

async function ensureFeedSchema(db: D1Database): Promise<void> {
  await db
    .prepare("CREATE TABLE IF NOT EXISTS feed_passes (token TEXT PRIMARY KEY, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, payer TEXT NOT NULL DEFAULT '')")
    .run();
  await db
    .prepare("ALTER TABLE feed_passes ADD COLUMN payer TEXT NOT NULL DEFAULT ''")
    .run()
    .catch((error: unknown) => {
      if (!/duplicate column/i.test(String(error))) throw error;
    });
}

/** The wallet a paying call pays from, read from its x402 payment; empty when it can't be read. */
export function payerOf(extra: Parameters<ToolCallback>[0]): string {
  const headers = (extra.requestInfo?.headers ?? {}) as Record<string, unknown>;
  const token = extra._meta?.["x402/payment"] ?? headers["PAYMENT-SIGNATURE"] ?? headers["X-PAYMENT"];
  try {
    const { payload } = JSON.parse(atob(String(token))) as { payload?: { authorization?: { from?: string }; permit2Authorization?: { from?: string } } };
    const from = payload?.authorization?.from ?? payload?.permit2Authorization?.from ?? "";
    return ADDRESS.test(from) ? from : "";
  } catch {
    return "";
  }
}

/** A new pass for `payer`, good for `FEED_DAYS` from now. */
export async function mintPass(db: D1Database, payer: string): Promise<{ pass: string; expires_at: string }> {
  await ensureFeedSchema(db);
  const now = new Date();
  const pass = `pass_${crypto.randomUUID().replaceAll("-", "")}`;
  const expires_at = new Date(now.getTime() + FEED_DAYS * DAY_MS).toISOString();
  await db
    .prepare("INSERT INTO feed_passes(token,expires_at,created_at,payer) VALUES (?1,?2,?3,?4)")
    .bind(pass, expires_at, now.toISOString(), payer)
    .run();
  return { pass, expires_at };
}

type Proof = { id: string; pass?: string; signed_at?: string; signature?: string };

/** Why this read isn't covered by its pass, or null when the wallet that bought the pass signed it just now. */
export async function unproven(db: D1Database, proof: Proof, now = Date.now()): Promise<string | null> {
  const { id, pass, signed_at, signature } = proof;
  if (typeof pass !== "string" || !PASS.test(pass)) return "that isn't a pass from subscribe";
  await ensureFeedSchema(db);
  const holder = await db
    .prepare("SELECT payer FROM feed_passes WHERE token = ?1 AND expires_at > ?2")
    .bind(pass, new Date(now).toISOString())
    .first<string>("payer");
  if (!holder || !ADDRESS.test(holder)) return "this pass has run out or isn't from this store";
  if (!signed_at || !signature || !SIGNATURE.test(signature)) {
    return `a pass read must be signed by the wallet that bought it: sign "${passMessage(pass, id, "<signed_at>")}" and send signed_at and signature`;
  }
  const at = Date.parse(signed_at);
  if (!Number.isFinite(at) || Math.abs(now - at) > PROOF_WINDOW_MS) return "signed_at must be within 10 minutes of now";
  const signed = await verifyMessage({
    address: holder as `0x${string}`,
    message: passMessage(pass, id, signed_at),
    signature: signature as `0x${string}`
  }).catch(() => false);
  return signed ? null : "this pass belongs to another wallet";
}

type Publication = { id: string; title: string };
type Handler = (args: Proof, extra: Parameters<ToolCallback>[0]) => Promise<CallToolResult>;

/** Let `get` deliver to a proven pass holder before free copies or x402 are asked. A paying call, or one
 * without a pass, reaches the tool unchanged; one whose pass isn't proven gets the payment challenge
 * with the reason beside it. */
export function passFirst(
  db: D1Database,
  tool: RegisteredTool,
  find: (id: string) => Promise<Publication | null>,
  deliver: (publication: Publication) => CallToolResult
): void {
  const next = tool.handler as Handler;
  const callback: Handler = async (args, extra) => {
    if (paying(extra) || args.pass === undefined) return next(args, extra);
    const problem = await unproven(db, args);
    const found = problem ? null : await find(args.id);
    if (!found) {
      const challenge = await next(args, extra);
      return problem ? { ...challenge, content: [...challenge.content, { type: "text", text: `Pass not accepted: ${problem}.` }] } : challenge;
    }
    return withSpan("lore.get", (setAttributes) => {
      setAttributes(() => toolSpanAttributes({ tool: "get", outcome: "ok", paid: false, itemId: found.id }));
      return deliver(found);
    });
  };
  tool.update({ callback: callback as NonNullable<Parameters<RegisteredTool["update"]>[0]["callback"]> });
}

/** When a card subscription bought at `boughtAt` runs out. */
export const cardPassEnds = (boughtAt: string) => new Date(Date.parse(boughtAt) + FEED_DAYS * DAY_MS);

const BROWSER = /^browser_[0-9a-f]{32}$/;

async function ensureBindingSchema(db: D1Database): Promise<void> {
  await db.prepare("CREATE TABLE IF NOT EXISTS feed_browsers (session_id TEXT PRIMARY KEY, browser TEXT NOT NULL)").run();
}

/** Tie a card subscription to the browser that opens it first, reusing that browser's token when it has one.
 * Null for any other browser; `fresh` when this open made the tie, so the cookie is set. */
export async function bindBrowser(db: D1Database, session: string, cookie: string | undefined): Promise<{ browser: string; fresh: boolean } | null> {
  await ensureBindingSchema(db);
  const mine = cookie && BROWSER.test(cookie) ? cookie : undefined;
  const browser = mine ?? `browser_${crypto.randomUUID().replaceAll("-", "")}`;
  const claimed = await db.prepare("INSERT OR IGNORE INTO feed_browsers(session_id,browser) VALUES (?1,?2)").bind(session, browser).run();
  if (claimed.meta.changes) return { browser, fresh: true };
  const bound = await db.prepare("SELECT browser FROM feed_browsers WHERE session_id = ?1").bind(session).first<string>("browser");
  return mine && mine === bound ? { browser: mine, fresh: false } : null;
}
