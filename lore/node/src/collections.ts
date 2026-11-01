/** Collections (MON-044): a named set of the store's pieces sold together at one price.
 * `lore push` writes them; a node pushed before they existed has no tables and sells none. */
import type { Copy } from "./receipts.js";

/** What the collection's page shows of each piece: only what its own page would. */
export type Shelved = { id: string; teaser: string; kind: string; updated_at: string };

export type Collection = { id: string; title: string; price_usd: number; pieces: string[]; shelf: Shelved[] };

type Member = { id: string; title: string; content: string; topic: string; kind: string; updated_at: string };

/** Every collection on sale with at least one advertised piece, its pieces in the owner's order. */
export async function collections(db: D1Database): Promise<Collection[]> {
  type Row = { id: string; title: string; price_usd: number; piece: string; teaser: string; kind: string; updated_at: string };
  let rows: Row[];
  try {
    ({ results: rows } = await db
      .prepare(
        `SELECT c.public_id AS id, c.title, c.price_usd, m.piece_id AS piece, p.teaser, p.kind,
                substr(p.updated_at, 1, 10) AS updated_at
         FROM collections c JOIN collection_pieces m ON m.collection_id = c.public_id
         JOIN publications p ON p.public_id = m.piece_id
         WHERE c.price_usd > 0 AND p.teaser <> ''
         ORDER BY c.title, c.public_id, m.position`
      )
      .all<Row>());
  } catch {
    return [];
  }
  const found = new Map<string, Collection>();
  for (const { id, title, price_usd, piece, teaser, kind, updated_at } of rows) {
    const collection = found.get(id) ?? { id, title, price_usd, pieces: [], shelf: [] };
    collection.pieces.push(piece);
    collection.shelf.push({ id: piece, teaser, kind, updated_at });
    found.set(id, collection);
  }
  return [...found.values()];
}

/** What `discover` says about a collection; `value_usd` is what its pieces cost bought one by one. */
export const listing = ({ id, title, price_usd, pieces }: Collection, pieceUsd: number) => ({
  id,
  title,
  price_usd,
  pieces,
  value_usd: Number((pieces.length * pieceUsd).toFixed(6)),
  tool: toolName({ id })
});

export const toolName = ({ id }: Pick<Collection, "id">) => `collection_${id}`;

/** The collection's pieces in full, as they stand now. */
export async function members(db: D1Database, collection: Collection): Promise<Member[]> {
  const { results } = await db
    .prepare(
      `SELECT p.public_id AS id, p.title, p.content, p.topic, p.kind, p.updated_at
       FROM collection_pieces m JOIN publications p ON p.public_id = m.piece_id
       WHERE m.collection_id = ?1 AND p.teaser <> '' ORDER BY m.position`
    )
    .bind(collection.id)
    .all<Member>();
  return results;
}

/** A card buyer keeps the whole collection as one copy, every piece under its own heading. */
export async function collectionCopy(db: D1Database, collection: Collection): Promise<Copy | null> {
  const pieces = await members(db, collection);
  if (!pieces.length) return null;
  return {
    piece_id: collection.id,
    teaser: collection.title,
    kind: "collection",
    updated_at: pieces.map((piece) => piece.updated_at.slice(0, 10)).sort().at(-1) ?? "",
    title: collection.title,
    content: pieces.map((piece) => `## ${piece.title}\n\n${piece.content}`).join("\n\n")
  };
}
