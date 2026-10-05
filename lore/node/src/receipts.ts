/** Card receipts (XC-039): the copy a buyer paid for, kept from the first verified
 * payment, so their link keeps opening it after the piece is edited or taken down,
 * or the store stops taking cards. A push replaces only publications and settings,
 * so receipts survive every push. */

export type Copy = {
  piece_id: string;
  teaser: string;
  kind: string;
  updated_at: string;
  title: string;
  content: string;
};

export async function ensureReceiptSchema(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS card_receipts (
      tx TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      piece_id TEXT NOT NULL,
      teaser TEXT NOT NULL,
      kind TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      bought_at TEXT NOT NULL
    )`
    )
    .run();
}

/** The copy this receipt bought, if it was ever kept; only for the piece the link names. */
export async function keptCopy(db: D1Database, session: string, pieceId: string): Promise<Copy | null> {
  await ensureReceiptSchema(db);
  return db
    .prepare(
      "SELECT piece_id, teaser, kind, updated_at, title, content FROM card_receipts WHERE session_id = ?1 AND piece_id = ?2"
    )
    .bind(session, pieceId)
    .first<Copy>();
}

/** Keep the copy once per payment; a later call for the same payment keeps the first. */
export async function keepCopy(db: D1Database, session: string, tx: string, copy: Copy): Promise<void> {
  await ensureReceiptSchema(db);
  await db
    .prepare(
      `INSERT OR IGNORE INTO card_receipts(tx,session_id,piece_id,teaser,kind,updated_at,title,content,bought_at)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)`
    )
    .bind(tx, session, copy.piece_id, copy.teaser, copy.kind, copy.updated_at, copy.title, copy.content, new Date().toISOString())
    .run();
}
