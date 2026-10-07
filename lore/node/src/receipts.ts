/** Card receipts (XC-039): the copy a buyer paid for, kept from the first verified
 * payment, so their link keeps opening it after the piece is edited or taken down,
 * or the store stops taking cards. A free copy (MON-040) is kept the same way.
 * A push replaces only publications and settings, so receipts survive every push. */

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
      session_id TEXT PRIMARY KEY,
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

const KEEP = `INSERT OR IGNORE INTO card_receipts(session_id,piece_id,teaser,kind,updated_at,title,content,bought_at)
  SELECT ?1,?2,?3,?4,?5,?6,?7,?8`;

const kept = (db: D1Database, sql: string, session: string, copy: Copy) =>
  db
    .prepare(sql)
    .bind(session, copy.piece_id, copy.teaser, copy.kind, copy.updated_at, copy.title, copy.content, new Date().toISOString());

/** Keep the copy once per payment; a later call for the same payment keeps the first. */
export function keepCopy(db: D1Database, session: string, copy: Copy): D1PreparedStatement {
  return kept(db, KEEP, session, copy);
}

/** Keep a free copy (MON-040) only if the ledger gave it under this link, in the same batch. */
export function keepFreeCopy(db: D1Database, link: string, copy: Copy): D1PreparedStatement {
  return kept(db, `${KEEP} WHERE EXISTS (SELECT 1 FROM sales WHERE network = 'free' AND tx = ?1)`, link, copy);
}
