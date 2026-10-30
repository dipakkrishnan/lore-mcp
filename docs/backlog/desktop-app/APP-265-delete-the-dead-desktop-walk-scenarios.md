---
id: APP-265
title: Delete the dead desktop walk scenarios
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-266, XC-077, APP-247]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

`app/desktop/support/edge.cjs` and `support/edge.sh` still carry three
scenarios, `listing`, `extras` and `firstrun`, that `support/walks.cjs` does
not list, so CI never runs them. Dead scenarios cost reading time in a
3,122-line file, drift from the renderer without anyone noticing, and make
the walk-to-view table (APP-266) ambiguous about what is actually scanned.

## Proposed approach

Remove the three scenario branches from edge.cjs and their seed and server
blocks from edge.sh. Before deleting, record which `shot()` labels each dead
scenario took, and confirm against the latest green main run's walks log that
none of those labels appears, so the deletion provably changes no CI scan.
If one of the three is worth keeping, add it to walks.cjs instead and say
why in Notes; the default is deletion.

## Acceptance criteria

- [x] `grep -nE 'listing|extras|firstrun' app/desktop/support/edge.cjs
      app/desktop/support/edge.sh` matches no scenario code.
- [x] All 21 walks pass on the PR's `Desktop macOS checks` run.
- [x] Layout scan: the Notes list each deleted scenario's screenshot labels
      and show none appears in the latest green main walks log, so no view
      scanned in CI before this change is unscanned after it.

## Notes

- Workstream A4 of the test-pyramid plan. Found during the 2026-10-29 survey
  of edge.cjs against walks.cjs (21 entries).
- Done 2026-10-30, on top of APP-266 (PR #612), whose `views.json` filed the
  dead labels. Deleted: the `listing`, `extras` and `firstrun` walk branches
  in `support/edge.cjs` (25, 22 and 215 lines), `listing`'s boot branch (its
  `shell.openExternal` stub), `firstrun`'s share of the `agents` boot branch
  and of `NARROW`, and the hold/fail-once IPC plumbing only `firstrun` used
  (`held`, `failOnce`, `late`, `holdAnswer`, `hold`, and the never-read
  `signedInToCloudflare`). In `support/edge.sh`: the `listing`, `extras` and
  `firstrun` seed blocks, `firstrun`'s share of the `agents` server block and
  of the no-seed list, its 300 s limit, and the first-run `skipped` write is
  now unconditional (every walk starts past the chat). edge.cjs 3,122 → 2,831
  lines, edge.sh 291 → 258. No fixture file was theirs alone: the stand-in
  node (`tests/fixtures/inbox.py`) and the marketplace file are the `agents`
  and `settings` walks' too. `views.json`'s `dead.scenarios` is `[]`; the
  block stays because `test/views.test.cjs`'s schema reads it, and it remains
  the escape hatch for any future scenario edge.cjs has that walks.cjs does
  not run. `test/views.test.cjs` 6/6.
- The PR (#613, based on #612's branch) ran `tests.yml` as run 41099405546
  (commit 5ccd8aa6); its `Desktop macOS checks` job 124213621031 logged
  `21/21 walks passed in 344s, 2 at a time`, `0 of 21 walks passed on retry`.
- Shot labels of the deleted scenarios, from views.json's `dead.scenarios`
  (14): `listing`: settings-list-offer, settings-list-pending. `extras`:
  extras-card, extras-approved. `firstrun`: firstrun-greeting,
  firstrun-apps-failed, firstrun-apps-connected, firstrun-pick,
  firstrun-store, firstrun-connect, firstrun-resumed, firstrun-saved,
  firstrun-see-them, firstrun-skipped-today.
- Proof none ran in CI: the latest green main `tests.yml` run before this
  change is 40995303688 (main at 454fd933, 2026-10-30 03:04 UTC); its
  `Desktop macOS checks` job is 123866929712 (`gh api
  repos/dipakkrishnan/lore-mcp/actions/jobs/123866929712/logs`, 2,090 lines,
  `21/21 walks passed in 393s`, 0 on retry). Every scan is logged as
  `PASS the text sits right in <label>` (and `<label>, 900px wide` for the
  narrow set). Counting each of the 14 labels as a whole label (not a
  substring) gives 0 for every one. The only substring hits were the live
  `today-extras-approved` (2 lines, the `settings` walk), which is why the
  count must be whole-label. The words `listing` and `firstrun` appear only as
  a `node:test` case name and in the `settings` walk's check "Settings offers
  no marketplace listing for it", not as scenario code. So no view scanned in
  CI before this change is unscanned after it.
- Remaining `grep -nE 'listing|extras|firstrun'` matches, read one by one:
  edge.sh:13 (comment saying every walk starts past the first-run chat);
  edge.sh:133 (`lore publication extras draft`, the `settings` walk's seed);
  edge.cjs `.extras-batch`, `today-extras-*` shots and `window.lore.extras()`
  (the `settings` walk's free-parts feature, lines ~1480-1505); edge.cjs
  ~1997 (the `agents` walk's "no marketplace listing" check). All feature
  code, none scenario code.
- Coverage finding from APP-266, recorded, not acted on: the first-run chat
  ("Welcome to Lore") and `listing`'s marketplace rows in Settings were
  scanned by no live walk, so deleting `firstrun` and `listing` removes zero
  CI coverage, but the first-run view now has no layout scan at all and no
  code path that could give it one. The `first-run` row stays in views.json
  with `scans: []` so the gap stays visible. Adding a walk for it is the
  owner's call (the item's default was deletion); if one is added it belongs
  in walks.cjs, where CI runs it. `extras`' card is already covered by the
  `settings` walk's `today-extras-*` shots.
- Width finding from APP-266, acted on here: the app window is 1040 px wide
  (`createWindow` in `src/main.cjs`), not 1280; APP-271's Layout scan
  criterion, approach and Notes now say 1040 px.
- APP-215's note "The `firstrun` edge walk drives it end to end" is history as
  of this item: the renderer's first run is covered by `test/app.test.cjs`'s
  `FirstRun` cases, not by a walk.
