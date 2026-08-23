---
id: APP-011
title: Open a memory from the Memories list
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-001, APP-002, APP-009, APP-010, CLI-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-08-22
---

## Problem

The Memories view lists every private memory by title, project, and date, but
nothing happens when the owner clicks one. "Lore kept this" is an empty claim
when the owner cannot see what was kept, and it is the first thing a
dogfooder reaches for after signing in. Three layers each stop short: the rows
are plain `row()` divs with no handler, `lore desktop-state` deliberately
omits memory bodies (APP-001), and the CLI has no single-memory read — only
`lore search --json`, which happens to return full `Memory` objects including
`content`.

## Proposed approach

Add `lore memory show <id> --json` to the CLI: one lookup on the existing
store, printing the same `Memory` shape `search --json` already emits. The
body lives in the `memories` table alongside every field the list shows, so
no schema work is needed. In the app, add a `memory:read` IPC validated the
way `search:query` is (positive integer id only) and make each Memories row a
button that opens the body in a sheet or expanded row reusing the existing
`.memory` card style from the capture approval card. Keep the snapshot
contract as it is — bodies are read on demand, never bulk-loaded. Edit and
discard from that view are out of scope here (CLI-001 owns pruning); this item
is read-only.

## Acceptance criteria

- [ ] `lore memory show <id> --json` prints one memory as JSON and exits
      non-zero with a plain message for an unknown id.
- [ ] Clicking a row in Memories (list or search results) shows that memory's
      full content, title, project, source, and date without leaving the view,
      and can be dismissed with Escape or a close control.
- [ ] Rows are real buttons: focusable, activatable with Enter/Space, with a
      pointer cursor.
- [ ] `lore desktop-state` output is unchanged; bodies are fetched per click.
- [ ] The `memory:read` handler rejects non-integer and non-positive ids
      before invoking the CLI.
- [ ] Desktop tests cover the IPC validation; a Python test covers
      `memory show` for a known and an unknown id.

## Notes

Found while dogfooding the packaged app on 2026-08-22 (PR #121 era). The
design frames (Aug 22 canvas) show Memories as an inventory and never drew a
detail screen, so this is a scope gap rather than a regression. If the sheet
grows actions later (discard, edit, "publish this"), those should each be
their own item so the attended-gate rules from APP-006 apply per action.
