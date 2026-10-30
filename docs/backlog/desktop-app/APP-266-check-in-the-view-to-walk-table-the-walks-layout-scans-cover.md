---
id: APP-266
title: Check in the view-to-walk table the walks' layout scans cover
priority: P1
effort: S
component: desktop-app
status: completed
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

- [x] A checked-in table lists every view with the walks and widths that
      scan it, derived from edge.cjs's `shot()` calls.
- [x] A test fails when edge.cjs has a `shot()` label the table does not
      account for, or the table names a walk not in `support/walks.cjs`.
- [x] The table's `README.md` paragraph says what the scan checks (overlap,
      clipping) and that a jsdom or vm assertion never counts as a layout
      check.
- [x] Layout scan: this item is the measurement itself; it changes no walk
      and no view's coverage.

## Notes

- Workstream A5 of the test-pyramid plan. Every walk retirement (APP-269,
  APP-270) cites this table for the views it moves; APP-271 (cheaper walks)
  uses it to keep one scan per view per walk.
- Done 2026-10-30. `app/desktop/support/views.json`: 30 views, 163 distinct
  labels from 162 `shot()` calls (the `settings` walk's
  `settings-appearance-${DARK ? "light" : "dark"}` expands to two), all 21
  walks named. `app/desktop/test/views.test.cjs` (6 node:test cases, read by
  `npm test`) parses `shot(...)` out of edge.cjs, expanding `${X ? "a" : "b"}`
  templates both ways, and fails when a label has no row, a row's label is
  gone from edge.cjs, a live row names a walk not in walks.cjs, a `dead`
  scenario is in walks.cjs or gone from edge.cjs, the widths disagree with
  edge.cjs's `NARROW`/`NARROW_WIDTH` or main.cjs's window, or the dark walks
  disagree with walks.cjs's `appearance`. Checked by mutating the table: a
  renamed label fails cases 1 and 2 naming it, a row naming `firstrun` fails
  case 3 and the widths case; restored, 6/6 pass. `npm test` in app/desktop:
  178 tests, 176 pass, one known-gap todo, one flake in `test/app.test.cjs`
  (updates; passes 28/28 alone) untouched by this item.
  The README paragraph sits after the CI/walks paragraph in
  `app/desktop/README.md`. edge.cjs, walks.cjs and every view's coverage are
  untouched.
- The widths in this item were wrong: nothing opens the window at 1280 px.
  `createWindow` in `src/main.cjs` opens it at 1040 × 760 and edge.cjs/edge.sh
  never resize it, so every walk scans at 1040 px; the narrow set re-scans
  each shot at 900 px (`NARROW_WIDTH`). The table says 1040 and the test
  checks it against main.cjs. The "186 `shot()` calls" was a loose count
  (`grep shot(` also matches `snapshot()`); there are 162.
- The narrow set in edge.cjs is `today, store, connectors, automations,
  settings, firstrun, agents` (seven). `firstrun` is not in walks.cjs, so six
  live walks scan at 900 px; the table's `narrow.walks` lists those six.
- Dead scenarios: `listing`, `extras` and `firstrun` are in edge.cjs but not
  in walks.cjs (APP-265 deletes them). Their 14 labels are filed under
  `dead.scenarios` in views.json, each against the view it would scan, and the
  test accepts them there only while the scenario exists in edge.cjs and is
  absent from walks.cjs, so APP-265 must empty that list as it deletes them.
  Consequence worth knowing: the first-run chat (`Welcome to Lore`) is
  scanned only by `firstrun`, so no view of it has a layout check in CI today
  (`first-run` row, `scans: []`). `listing`'s marketplace rows in Settings
  likewise; `extras`' card is covered by the `settings` walk's
  `today-extras-*` shots.
- What the scan actually sees, read from LAYOUT's roots (edge.cjs ~405-407):
  with a `dialog:modal` open, only the sheet plus any popover or `.peek` is
  scanned, never the page under it. So every shot with a sheet open is a row
  for that sheet, not for the page it was opened from; the account menu (a
  popover) and the memory preview (`.peek`) are not modal, so their shots also
  scan the page beneath. This is why the table has one row per sheet.
- Things in edge.cjs that did not fit the view model: `shimmer-1.png`/
  `shimmer-2.png` (seller) and `sell-preview.png` (sell) are written with
  `capturePage()` alone, no scan, so they are not labels and have no row;
  the preview page window has no layout check at all (`preview-window`,
  `scans: []`). Views the walks drive but never `shot()` while open, so they
  have no layout check: the feedback sheet (it closes itself before
  `feedback-filed`), the Change time sheet, and the "Disconnect Edge Vault?"
  confirm. Settings has no tabs: it is one scrolling page, and the scan
  covers every section in the DOM, so Settings is one row with the sections
  listed in `about`. Labels named `settings-*` in the `obsidian`, `jobs` and
  `connectors` walks scan Connectors, not Settings (they date from when
  Connectors lived in Settings); the table files them by what they scan.
- Dark: the `faq` walk is launched dark (every shot), and `connectors` and
  `settings` flip the appearance mid-walk for four shots; `dark` in
  views.json lists both, checked against walks.cjs's `appearance`.
