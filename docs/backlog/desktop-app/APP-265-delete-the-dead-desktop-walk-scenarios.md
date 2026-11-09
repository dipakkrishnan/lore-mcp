---
id: APP-265
title: Delete the dead desktop walk scenarios
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-266, XC-077, APP-247, APP-215, XC-090]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-04
---

## Problem

`app/desktop/support/edge.cjs` and `support/edge.sh` carried three scenarios,
`listing`, `extras` and `firstrun`, that `support/walks.cjs` does not list, so
CI never runs them. Dead scenarios cost reading time in a 3,100-line file,
drift from the renderer without anyone noticing, and make the walk-to-view
table (APP-266) ambiguous about what is actually scanned.

Two of the three are dead. The third, `firstrun`, is not: it is run by hand
(`support/edge.sh firstrun`), edge.sh seeds it specially (APP-215), and it was
extended after this item was filed (XC-090 #635, APP-281 #638, APP-283 #641).
It stays.

## Proposed approach

Remove the `listing` and `extras` scenario branches from edge.cjs and their
seed blocks from edge.sh. Before deleting, record which `shot()` labels each
dead scenario took, and confirm against the latest green main run's walks log
that none of those labels appears, so the deletion provably changes no CI
scan. Keep `firstrun`: it is worth keeping as a hand-run walk, and
`views.json` keeps it under `dead` so the table still says its labels scan
nothing in CI.

## Acceptance criteria

- [x] `grep -nE 'listing|extras' app/desktop/support/edge.cjs
      app/desktop/support/edge.sh` matches no scenario code (what remains is
      the settings walk's `today-extras-*` labels, its `lore publication
      extras draft` seed, and a FAQ check's words "marketplace listing").
      `firstrun` is kept on purpose, see Notes.
- [x] All 21 walks pass on the PR's `Desktop macOS checks` run.
- [x] Layout scan: the Notes list each deleted scenario's screenshot labels
      and show none appears in the latest green main walks log, so no view
      scanned in CI before this change is unscanned after it. Four labels
      were removed from `views.json`'s `dead` list.

## Notes

- Workstream A4 of the test-pyramid plan. Found during the 2026-10-29 survey
  of edge.cjs against walks.cjs (21 entries).
- Premise change (2026-11-04): the item named `firstrun` as dead. It is not
  run by CI, but it is run by hand: edge.sh seeds a new owner's vault for it
  (APP-215), gives it a longer limit for its five relaunches, and the owner
  extended it in three merged PRs after this item was filed (XC-090 #635
  "Report how far a new owner gets through the first-run chat", APP-281 #638,
  APP-283 #641). Deleting it would have thrown away a live manual check, so
  it stays in edge.cjs and edge.sh and under `dead` in `views.json`, whose
  `about` now says why. `test/views.test.cjs` still requires every `dead`
  scenario to exist in edge.cjs and be absent from walks.cjs, which holds.
  An earlier PR (#613) deleted all three and went stale; this item's PR
  supersedes it.
- Deleted labels, by scenario and the view each would have scanned:
  `listing`: `settings-list-offer`, `settings-list-pending` (Settings);
  `extras`: `extras-card`, `extras-approved` (Today). Latest green main
  walks log before the change: `Desktop macOS checks` of run 41770412043
  (main at e7a13e53, 2026-11-04, 21/21 walks passed, 0 on retry). None of the
  four labels appears in it (the only substring hits are the live settings
  walk's `today-extras-approved`). No `firstrun-*` label appears either,
  which is what `dead` records about it.
- Helpers: nothing was used only by `listing` or `extras`. `opened` (the
  `shell.openExternal` record) is still used by the `cards` and
  `agents`/`firstrun` branches, so it stays.
- Line counts: edge.cjs 3147 → 3097 (50 lines removed), edge.sh 319 → 294
  (25 lines removed).
- APP-119 and MON-039's Notes still name `edge.sh listing` and `edge.sh
  extras` as the edge check that drove their work at the time; those are
  records of completed items and were left as written.
