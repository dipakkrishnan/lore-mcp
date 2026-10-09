/** Free first copies (MON-040): each piece gives its first few copies away, so a first
 * reader needs no wallet and no card. The sales ledger is the counter: every free copy
 * is a row worth $0, so the seller sees it and earnings stay what was paid. */
import type { RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readAnswerSettings } from "./answer-state.js";
import { type Copy, keepFreeCopy } from "./receipts.js";
import { ensureSalesSchema } from "./sales.js";
import { toolSpanAttributes } from "./telemetry.js";
import { withSpan } from "./tracing.js";

/** The ledger's network for a free copy: nothing moved, so there is nothing to see or refund. */
export const FREE = "free";
/** A free copy's link, shaped apart from a card session so it can never be checked with checkout. */
export const FREE_LINK = /^free_[0-9a-f]{32}$/;

const freeLink = () => `free_${crypto.randomUUID().replaceAll("-", "")}`;

/** How many of this piece's free copies are left. */
export async function freeLeft(db: D1Database, item: string, copies: number): Promise<number> {
  if (!copies) return 0;
  await ensureSalesSchema(db);
  const given = await db
    .prepare(`SELECT COUNT(*) AS given FROM sales WHERE network = '${FREE}' AND item_id = ?1`)
    .bind(item)
    .first<number>("given");
  return Math.max(0, copies - (given ?? 0));
}

/** Give one copy while fewer than `copies` were given. One statement, so readers claiming at
 * once can never take more than `copies` between them. */
function give(db: D1Database, item: string, title: string, link: string, copies: number): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sales(kind,item_id,title,price_usd,network,payer,tx,sold_at)
       SELECT 'publication',?1,?2,0,'${FREE}','',?3,?4
       WHERE (SELECT COUNT(*) FROM sales WHERE network = '${FREE}' AND item_id = ?1) < ?5`
    )
    .bind(item, title, link, new Date().toISOString(), copies);
}

/** Give a reader one copy and keep it under a link of its own, both or neither; null once none are left. */
export async function giveCopy(db: D1Database, copy: Copy, copies: number): Promise<string | null> {
  const link = freeLink();
  const [given] = await db.batch([give(db, copy.piece_id, copy.title, link, copies), keepFreeCopy(db, link, copy)]);
  return given.meta.changes ? link : null;
}

type Publication = { id: string; title: string };
type Handler = (args: { id: string }, extra: Parameters<ToolCallback>[0]) => Promise<CallToolResult>;

/** Where `agents/x402` looks for a payment; a call carrying one always pays. */
export function paying(extra: Parameters<ToolCallback>[0]): boolean {
  const headers = (extra.requestInfo?.headers ?? {}) as Record<string, unknown>;
  return Boolean(extra._meta?.["x402/payment"] ?? headers["PAYMENT-SIGNATURE"] ?? headers["X-PAYMENT"]);
}

/** Let `get` give a free copy before x402 asks for payment. Only an unpaid call for a piece
 * with copies left is diverted; everything else reaches the paid tool unchanged. */
export function freeFirst(
  db: D1Database,
  tool: RegisteredTool,
  find: (id: string) => Promise<Publication | null>,
  deliver: (publication: Publication) => CallToolResult
): void {
  const paid = tool.handler as Handler;
  const callback: Handler = async (args, extra) => {
    if (paying(extra)) return paid(args, extra);
    const copies = (await readAnswerSettings(db)).freeCopies;
    const found = copies ? await find(args.id) : null;
    if (found) await ensureSalesSchema(db);
    // The copy is a ledger row only: an agent keeps what `get` returned, so no link is kept.
    const given = found && (await give(db, found.id, found.title, freeLink(), copies).run()).meta.changes;
    if (!found || !given) return paid(args, extra);
    return withSpan("lore.get", (setAttributes) => {
      setAttributes(() => toolSpanAttributes({ tool: "get", outcome: "ok", paid: false, itemId: found.id }));
      return deliver(found);
    });
  };
  tool.update({ callback: callback as NonNullable<Parameters<RegisteredTool["update"]>[0]["callback"]> });
}
