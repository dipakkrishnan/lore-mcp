/** Page views per piece: a count and nothing else, so no visitor can ever be told apart.
 * Like `sales`, a push never touches this table. */
export async function countView(db: D1Database, item: string): Promise<void> {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS page_views (item_id TEXT PRIMARY KEY, views INTEGER NOT NULL)"),
    db.prepare("INSERT INTO page_views(item_id, views) VALUES (?1, 1) ON CONFLICT(item_id) DO UPDATE SET views = views + 1").bind(item)
  ]);
}
