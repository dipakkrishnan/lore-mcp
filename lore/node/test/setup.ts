import { env } from "cloudflare:workers";

// Setup files run outside the per-test-file storage isolation and may run
// more than once, so this must be idempotent. Mirrors the schema `lore push`
// maintains (lore/store.py) and the seed step in .github/workflows/tests.yml.
// `D1Database.exec()` splits on newlines, so the statement must stay on one line.
await env.LORE_DB.exec(
  "CREATE TABLE IF NOT EXISTS publications (public_id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, kind TEXT NOT NULL, topic TEXT NOT NULL DEFAULT '', teaser TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '')"
);

// Ids are checksummed (see `validPublicId` in src/index.ts); these are the
// only two 24-hex-char values used across the suite. The first is the same
// id scripts/smoke.ts already exercises as a structurally valid id.
export const FIXTURE_PUBLICATION_ID = "0000000000000000fcdb4b42";
const SECOND_PUBLICATION_ID = "1111111111111111807ae5f3";

await env.LORE_DB.batch([
  env.LORE_DB.prepare(
    `INSERT OR IGNORE INTO publications
       (public_id, title, content, kind, topic, teaser, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    FIXTURE_PUBLICATION_ID,
    "Fixture Publication",
    "the secret owner-approved content — never on the free surface",
    "note",
    "testing",
    "a teaser that is safe to advertise",
    "2026-01-01T00:00:00Z"
  ),
  env.LORE_DB.prepare(
    `INSERT OR IGNORE INTO publications
       (public_id, title, content, kind, topic, teaser, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(
    SECOND_PUBLICATION_ID,
    "Second Fixture",
    "other content, also never on the free surface",
    "note",
    "testing",
    "a second teaser",
    "2026-01-02T00:00:00Z"
  )
]);
