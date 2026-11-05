---
id: APP-265
title: Delete the dead desktop walk scenarios
priority: P2
effort: XS
component: desktop-app
status: ready
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

- [ ] `grep -nE 'listing|extras|firstrun' app/desktop/support/edge.cjs
      app/desktop/support/edge.sh` matches no scenario code.
- [ ] All 21 walks pass on the PR's `Desktop macOS checks` run.
- [ ] Layout scan: the Notes list each deleted scenario's screenshot labels
      and show none appears in the latest green main walks log, so no view
      scanned in CI before this change is unscanned after it.

## Notes

- Workstream A4 of the test-pyramid plan. Found during the 2026-10-29 survey
  of edge.cjs against walks.cjs (21 entries).
