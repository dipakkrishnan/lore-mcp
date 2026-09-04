---
id: APP-059
title: Let owners rename a memory
priority: P2
effort: S
component: desktop-app
status: in-progress
related: []
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/172
created: 2026-09-02
updated: 2026-09-03
---

## Problem

`lore/store.py`'s `Store` class has no mutation path for a memory's `title`
column — only `set_status`/`set_status_many` exist — and the desktop app's
memory detail sheet (`app/desktop/src/renderer.js` `openMemory`) only offers
"Draft for sale" and close. There is no rename affordance anywhere in the
CLI, IPC bridge, or renderer, so a memory stuck with a bad or stale title
has no fix short of editing the database directly.

## Proposed approach

Add `Store.set_title(memory_id, title)` mirroring `set_status`'s commit/
rowcount-check/`ValueError` shape, a `lore memory rename <id> <title>
[--json]` CLI subcommand, an IPC handler `memory:rename` backed by
`state.cjs`'s `renameMemory()`, and a Rename control in the memory detail
sheet that swaps the title into an editable input with Save/Cancel.

## Acceptance criteria

- [x] `lore memory rename <id> <title>` updates the row.
- [x] The desktop app's memory detail sheet has a Rename control that calls
      the rename path via IPC.
- [x] Covered by `app/desktop/test/app.test.cjs`, `tests/test_cli.py::RenameMemoryTest`,
      `tests/test_store.py::RenameTest`.

## Notes

Cataloged from #172 while unblocking PR #177's title-format check — the
issue was never cataloged before implementation started, so this item was
filed after the fact to give the PR a resolvable backlog id.

Renumbered from `APP-054` to `APP-059` on 2026-09-03 by an audit pass: it was
filed as `APP-054` from a branch cut before PR #192 landed
`APP-054-close-the-edge-audits-pre-freeze-findings.md`, so two items shared the
id and `INDEX.md` could not be regenerated. The edge-audit item merged first
and keeps `APP-054`. Merged PR #177's title and the cataloging comment on #172
still say `APP-054`; git history is left as it is.
