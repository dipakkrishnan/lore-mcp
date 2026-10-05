/** The sales ledger: one row per settled paid call, beside the answer tables
 * in the owner's own database.
 *
 * `agents/x402` settles a payment after the tool's handler returns and leaves
 * the receipt in the result's metadata, so the handler itself never sees the
 * money move. `recorded` wraps the registered tool instead and writes the row
 * once the receipt says success. A push replaces only the publications and
 * settings tables, so sales survive every push.
 */
import type { RegisteredTool, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ShapeOutput, ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { settlementSpanAttributes } from "./telemetry.js";
import { withSpan } from "./tracing.js";

interface Receipt {
  success: boolean;
  transaction: string;
  network: string;
  payer?: string;
}

export interface Sale {
  item: string;
  title: string;
}

export async function ensureSalesSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('publication','answer')),
      item_id TEXT NOT NULL,
      title TEXT NOT NULL,
      price_usd REAL NOT NULL,
      network TEXT NOT NULL,
      payer TEXT NOT NULL DEFAULT '',
      tx TEXT NOT NULL,
      sold_at TEXT NOT NULL
    )`
    )
    .run();
}

/**
 * A paid answer that ends refused or failed is owed back. x402 pays the owner's own
 * wallet directly and Lore holds no key to it, so nothing can refund on-chain
 * automatically; the ledger marks the sale instead, and the owner refunds the payer.
 * Triggers set the mark whichever is written last, the sale or the job's end.
 */
export async function ensureRefundTracking(db: D1Database): Promise<void> {
  const columns = await db.prepare("PRAGMA table_info(sales)").all<{ name: string }>();
  if (!columns.results.some((column) => column.name === "refund_owed")) {
    await db.prepare("ALTER TABLE sales ADD COLUMN refund_owed INTEGER NOT NULL DEFAULT 0").run();
  }
  await db.batch([
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS refund_owed_on_end AFTER UPDATE OF status ON answer_jobs
       WHEN NEW.status IN ('refused','failed')
       BEGIN UPDATE sales SET refund_owed = 1 WHERE kind = 'answer' AND item_id = NEW.ticket_id; END`
    ),
    db.prepare(
      `CREATE TRIGGER IF NOT EXISTS refund_owed_on_sale AFTER INSERT ON sales
       WHEN NEW.kind = 'answer'
       BEGIN UPDATE sales SET refund_owed = 1 WHERE id = NEW.id AND EXISTS
         (SELECT 1 FROM answer_jobs WHERE ticket_id = NEW.item_id AND status IN ('refused','failed')); END`
    )
  ]);
}

/** Write one card sale, once: the buyer reopening their receipt page must not count it again. */
export async function recordCardSale(db: D1Database, sale: Sale & { priceUsd: number; tx: string }): Promise<void> {
  await ensureSalesSchema(db);
  await db
    .prepare(
      `INSERT INTO sales(kind,item_id,title,price_usd,network,payer,tx,sold_at)
       SELECT 'publication',?1,?2,?3,'stripe','',?4,?5
       WHERE NOT EXISTS (SELECT 1 FROM sales WHERE network = 'stripe' AND tx = ?4)`
    )
    .bind(sale.item, sale.title, sale.priceUsd, sale.tx, new Date().toISOString())
    .run();
}

/** What a paid tool with input `Args` is called with; the SDK spells this as a conditional type that stays unresolved on a generic `Args`. */
type Paid<Args extends ZodRawShapeCompat> = (
  args: ShapeOutput<Args>,
  extra: Parameters<ToolCallback>[0]
) => ReturnType<ToolCallback>;

/** Write a sale each time `tool` settles; `sold` names what the buyer got from the tool's own payload. */
export function recorded<Args extends ZodRawShapeCompat>(
  db: D1Database,
  tool: RegisteredTool,
  kind: "publication" | "answer",
  priceUsd: number,
  sold: (payload: unknown, args: ShapeOutput<Args>) => Sale
): void {
  const paid = tool.handler as Paid<Args>;
  const callback: Paid<Args> = async (args, extra) => {
    const result = await paid(args, extra);
    const receipt = result._meta?.["x402/payment-response"] as Receipt | undefined;
    const [block] = result.content;
    if (receipt?.success && block.type === "text") {
      // Payment has already settled by this point (agents/x402's job, not
      // ours) — a bookkeeping failure here must never cost the buyer the
      // result they already paid for. The span never carries the receipt's
      // payer address or transaction hash — only whether the ledger write
      // itself succeeded.
      await withSpan("lore.sale", async (setAttributes) => {
        try {
          const { item, title } = sold(JSON.parse(block.text), args);
          await db
            .prepare(
              `INSERT INTO sales(kind,item_id,title,price_usd,network,payer,tx,sold_at)
               VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`
            )
            .bind(
              kind,
              item,
              title,
              priceUsd,
              receipt.network,
              receipt.payer ?? "",
              receipt.transaction,
              new Date().toISOString()
            )
            .run();
          setAttributes(() => settlementSpanAttributes({ settled: true, outcome: "ok" }));
        } catch {
          console.error("recorded(): failed to write sales row for a settled payment");
          setAttributes(() => settlementSpanAttributes({ settled: true, outcome: "ledger_failed" }));
        }
      });
    }
    return result;
  };
  tool.update({ callback: callback as ToolCallback<Args> });
}
