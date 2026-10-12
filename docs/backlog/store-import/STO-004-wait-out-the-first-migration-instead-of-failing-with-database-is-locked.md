---
id: STO-004
title: Wait out the first migration instead of failing with database is locked
priority: P1
effort: XS
component: store-import
status: ready
related: [APP-181]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
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

- [ ] A test starts several `lore` processes against an empty home at once and all succeed
- [ ] First launch of the desktop app on a fresh home shows no database error

## Notes

Filed from the 2026-10-06 new-seller audit.
