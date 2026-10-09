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

export type SaleKind = "publication" | "answer" | "collection" | "feed";

const salesTable = (name: string) => `CREATE TABLE ${name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('publication','answer','collection','feed')),
      item_id TEXT NOT NULL,
      title TEXT NOT NULL,
      price_usd REAL NOT NULL,
      network TEXT NOT NULL,
      payer TEXT NOT NULL DEFAULT '',
      tx TEXT NOT NULL,
      sold_at TEXT NOT NULL,
      refund_owed INTEGER NOT NULL DEFAULT 0
    )`;

/** The ledger, rebuilt once when a node made before collections and feeds still checks for two kinds.
 * SQLite can't alter a CHECK, so the rows move to a new table in one batch. The refund triggers name
 * the table, so they go too; `ensureRefundTracking` puts them back on the next start. */
export async function ensureSalesSchema(db: D1Database): Promise<void> {
  const found = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sales'")
    .first<string>("sql");
  if (!found) {
    await db.prepare(salesTable("IF NOT EXISTS sales")).run();
    return;
  }
  if (found.includes("'feed'")) return;
  const { results } = await db.prepare("PRAGMA table_info(sales)").all<{ name: string }>();
  const columns = results.map((column) => column.name).join(",");
  await db.batch([
    db.prepare("DROP TRIGGER IF EXISTS refund_owed_on_end"),
    db.prepare("DROP TRIGGER IF EXISTS refund_owed_on_sale"),
    db.prepare("DROP TABLE IF EXISTS sales_rebuild"),
    db.prepare(salesTable("sales_rebuild")),
    db.prepare(`INSERT INTO sales_rebuild(${columns}) SELECT ${columns} FROM sales`),
    db.prepare("DROP TABLE sales"),
    db.prepare("ALTER TABLE sales_rebuild RENAME TO sales")
  ]);
}

/**
 * A paid answer that ends refused or failed is owed back. x402 pays the owner's own
 * wallet directly and Lore holds no key to it, so nothing can refund on-chain
 * automatically; the ledger marks the sale instead, and the owner refunds the payer.
 * Triggers set the mark whichever is written last, the sale or the job's end.
 */
export async function ensureRefundTracking(db: D1Database): Promise<void> {
  await ensureRefundColumn(db);
  await db.batch([
    // Answers that ended unanswered before tracking existed.
    db.prepare(
      `UPDATE sales SET refund_owed = 1 WHERE kind = 'answer' AND refund_owed = 0
       AND item_id IN (SELECT ticket_id FROM answer_jobs WHERE status IN ('refused','failed'))`
    ),
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

/** The sales table, with the refund column a database made before refunds were tracked lacks.
 * Two sessions starting at once may both add it; the loser's "duplicate column" is harmless. */
export async function ensureRefundColumn(db: D1Database): Promise<void> {
  await ensureSalesSchema(db);
  await db
    .prepare("ALTER TABLE sales ADD COLUMN refund_owed INTEGER NOT NULL DEFAULT 0")
    .run()
    .catch((error: unknown) => {
      if (!/duplicate column/i.test(String(error))) throw error;
    });
}

/** One card sale, once: the buyer reopening their receipt and Stripe resending must not count it again. */
export function cardSale(db: D1Database, sale: Sale & { kind: SaleKind; priceUsd: number; tx: string; refundOwed: boolean }): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO sales(kind,item_id,title,price_usd,network,payer,tx,sold_at,refund_owed)
       SELECT ?7,?1,?2,?3,'stripe','',?4,?5,?6
       WHERE NOT EXISTS (SELECT 1 FROM sales WHERE network = 'stripe' AND tx = ?4)`
    )
    .bind(sale.item, sale.title, sale.priceUsd, sale.tx, new Date().toISOString(), sale.refundOwed ? 1 : 0, sale.kind);
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
  kind: SaleKind,
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
