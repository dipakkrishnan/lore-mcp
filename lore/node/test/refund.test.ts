import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ensureAnswerSchema } from "../src/answer-state";
import { ensureRefundTracking, ensureSalesSchema } from "../src/sales";

const db = env.LORE_DB;
const job = (ticket: string, status: string) =>
  db
    .prepare(
      `INSERT INTO answer_jobs(ticket_id,question,price_usd,status,created_at,updated_at)
       VALUES (?1,'q',0.5,?2,'2026-10-04','2026-10-04')`
    )
    .bind(ticket, status)
    .run();
const sale = (kind: string, item: string) =>
  db
    .prepare(
      `INSERT INTO sales(kind,item_id,title,price_usd,network,payer,tx,sold_at)
       VALUES (?1,?2,'q',0.5,'eip155:84532','0xpayer','0xtx','2026-10-04')`
    )
    .bind(kind, item)
    .run();
const owed = async (item: string) =>
  (await db.prepare("SELECT refund_owed FROM sales WHERE item_id = ?1").bind(item).first<{ refund_owed: number }>())?.refund_owed;

beforeAll(async () => {
  await ensureAnswerSchema(db);
  await ensureSalesSchema(db);
  await ensureRefundTracking(db);
  // Twice: tracking is set up on every session start.
  await ensureRefundTracking(db);
});

describe("a paid answer that ends without one", () => {
  it("is owed back when the job fails after the sale is written", async () => {
    await job("ticket-late-fail", "running");
    await sale("answer", "ticket-late-fail");
    expect(await owed("ticket-late-fail")).toBe(0);
    await db.prepare("UPDATE answer_jobs SET status = 'failed' WHERE ticket_id = 'ticket-late-fail'").run();
    expect(await owed("ticket-late-fail")).toBe(1);
  });

  it("is owed back when the job was already refused before the sale is written", async () => {
    await job("ticket-early-refuse", "refused");
    await sale("answer", "ticket-early-refuse");
    expect(await owed("ticket-early-refuse")).toBe(1);
  });

  it("is owed back for an answer that ended unanswered before tracking existed", async () => {
    await db.prepare("UPDATE sales SET refund_owed = 0").run();
    await job("ticket-before", "failed");
    await db.prepare("DROP TRIGGER refund_owed_on_sale").run();
    await sale("answer", "ticket-before");
    expect(await owed("ticket-before")).toBe(0);
    await ensureRefundTracking(db);
    expect(await owed("ticket-before")).toBe(1);
  });

  it("owes nothing for an answer that completes, or for a publication", async () => {
    await job("ticket-done", "running");
    await sale("answer", "ticket-done");
    await db.prepare("UPDATE answer_jobs SET status = 'complete' WHERE ticket_id = 'ticket-done'").run();
    expect(await owed("ticket-done")).toBe(0);
    await sale("publication", "piece-x");
    expect(await owed("piece-x")).toBe(0);
  });
});
