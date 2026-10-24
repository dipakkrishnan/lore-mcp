---
id: STO-004
title: Wait out the first migration instead of failing with database is locked
priority: P1
effort: XS
component: store-import
status: in-progress
related: [APP-181]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-07
---

## Problem

On a brand-new Lore home the desktop runs several `lore` commands at once.
They race to run the first migration, and the ones that lose fail with
"database is locked", which reaches Memories as "unable to open database
file". `lore/store.py` opens the database with `sqlite3.connect(self.path)`
and no busy timeout.

## Proposed approach

Set a busy timeout when the store opens (`sqlite3.connect(path, timeout=...)`
or `PRAGMA busy_timeout`). A second process then waits for the first
migration to finish instead of failing.

## Acceptance criteria

- [x] A test starts several `lore` processes against an empty home at once and all succeed
- [ ] First launch of the desktop app on a fresh home shows no database error

## Notes

Filed from the 2026-10-06 new-seller audit.

2026-10-07, first criterion done, second still open:

- **A busy timeout was already there.** Python's `sqlite3.connect` defaults to
  `timeout=5.0`, so the proposed approach on its own changes nothing. The
  timeout is now explicit (`BUSY_SECONDS`, 15s) but it is not the fix.
- **The cause is the switch to WAL.** While another connection is writing to a
  database that is still in rollback-journal mode, `PRAGMA journal_mode=WAL`
  fails at once with "database is locked" and never consults the busy timeout.
  That pragma was the first statement of the first migration, so the process
  that lost the race died there. `Store._enter_wal` now retries that one
  statement until `BUSY_SECONDS` runs out; any other error, and a filesystem
  that answers with its old journal mode, behave as before.
- **How often it happened.** Before the fix, concurrent `desktop-state`,
  `publication candidates`, `publication extras candidates` and
  `sources catalog` on an empty home failed about once in 65 rounds.
  After it, 60 rounds of ten processes (those four plus `search`) had no
  failed process of any kind.
- **The second criterion is not verified.** APP-181 records the message a
  seller saw as "unable to open database file". That is a different SQLite
  error from "database is locked", and it did not appear in any run here, before
  or after the fix. It may be the same race seen from the desktop, or it may be
  something else. Confirming it needs an attended first launch on a fresh home
  (`app/desktop/support/edge.sh fresh`), which this change did not get. CI's
  desktop job does not settle it: every scenario it runs except `connectors`
  seeds the database before the app starts.
- Every open now waits up to 15s on a held write lock where it used to wait 5s,
  including the MCP server's.
