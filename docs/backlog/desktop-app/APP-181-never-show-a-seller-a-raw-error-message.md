---
id: APP-181
title: Never show a seller a raw error message
priority: P1
effort: S
component: desktop-app
status: ready
related: [APP-085, APP-109, APP-014, STO-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Sellers see internal errors as page text. On a machine with no store, Sales
shows "no deployed node on this machine; open your store first". On a fresh
home, Memories showed "sqlite3.OperationalError: unable to open database file".
Neither tells a seller what happened or what to do.

## Proposed approach

- Treat "no store yet" as an empty state, not an error: Sales says "No sales
  yet. Sales show up here once your store is open." with Open your store.
- Map CLI failures to one plain sentence and a next step. Keep the raw
  text behind a Details disclosure and attach it to Report this problem.

## Acceptance criteria

- [ ] Sales with no store shows an empty state, not an error
- [ ] No tab renders a Python exception name or CLI error string as body text
- [ ] The raw error is still reachable for a bug report

## Notes

Filed from the 2026-10-06 new-seller audit. The database error on Memories
came from the migration race in STO-004.
