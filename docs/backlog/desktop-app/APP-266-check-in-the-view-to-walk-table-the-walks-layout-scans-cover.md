---
id: APP-266
title: Check in the view-to-walk table the walks' layout scans cover
priority: P1
effort: S
component: desktop-app
status: ready
related: [APP-265, APP-269, APP-270, APP-271, XC-108]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

The LAYOUT overlap and clip scan inside the walks (`shot()` in
`app/desktop/support/edge.cjs`, lines 353-649: SETTLE, then a full-DOM pass
with `getComputedStyle` and `elementsFromPoint`) is the repo's only visual
regression check. Screenshots are written and never compared; the scan is
the asserting part. It needs real Chromium layout, so no unit test can take
it over. The test-pyramid plan retires 14 of the 21 walks, and each
retirement must show that every view the walk scanned is still scanned by a
kept walk. Today nobody can show that, because which views each walk scans is
implicit in 186 `shot()` calls across 3,122 lines.

## Proposed approach

Read edge.cjs and write `app/desktop/support/views.json` (or a Markdown table
beside it, whichever the guard in XC-108 reads more easily): one row per view
the app has (sidebar sections, Today, each Settings tab, each sheet and
dialog, the account menu, the FAQ, the first-run and provisioning banners),
with the walks whose `shot()` calls scan it and at which widths (1280 px for
all, 900 px for the seven walks in the narrow set). Derive it from the shot
labels and the renderer state each scenario drives, not from memory. Add a
test that reads edge.cjs and the table and fails if a `shot()` label in the
code has no row, so the table cannot go stale silently. This is the baseline;
APP-270 rewrites it for the seven-walk set and XC-108 guards it.

## Acceptance criteria

- [ ] A checked-in table lists every view with the walks and widths that
      scan it, derived from edge.cjs's `shot()` calls.
- [ ] A test fails when edge.cjs has a `shot()` label the table does not
      account for, or the table names a walk not in `support/walks.cjs`.
- [ ] The table's `README.md` paragraph says what the scan checks (overlap,
      clipping) and that a jsdom or vm assertion never counts as a layout
      check.
- [ ] Layout scan: this item is the measurement itself; it changes no walk
      and no view's coverage.

## Notes

- Workstream A5 of the test-pyramid plan. Every walk retirement (APP-269,
  APP-270) cites this table for the views it moves; APP-271 (cheaper walks)
  uses it to keep one scan per view per walk.
