---
id: APP-269
title: Retire the first five walks whose checks now live in unit tests
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-266, APP-267, APP-268, APP-270, XC-083]
blockers: [APP-266, APP-267, APP-268]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

Five of the 21 walks assert things that are now, or will be after APP-267 and
APP-268, covered by unit tests, and each still costs an Electron boot, a seed
and a fresh CLI runtime on the macOS runner (latest green main run
40995303688, walks step 394 s of the job's 498 s):

- `today` (34 s): six seeded stages of `nextStep`, a function of state.
- `fresh` (40 s, with 15.7 s of fixed sleeps): the notice state machine and
  remember-write failure handling, drivable through a fake `window.lore`.
- `quiet` (18 s): the same seed and code block as `checkin` with
  `reach_out:false`; one extra assertion in `checkin` covers it.
- `obsidian` (18 s): vault offer, listing, connect and disconnect, all
  already exercised inside `connectors` (edge.cjs:1113-1130).
- `faq` (8 s, dark): sidebar, account menu, Escape, ⌘, and FAQ wording; its
  only dark-specific check is the boot theme.

## Proposed approach

For each walk: list what it asserts (from edge.cjs), point at the unit test
that now asserts it (APP-267's `ipc.test.cjs`, APP-268's renderer tests, or a
line added to a kept walk), remove it from `support/walks.cjs` and its
scenario from edge.cjs/edge.sh, and move its layout scans per APP-266's
table. The `quiet` seed is `checkin`'s; add the `reach_out:false` assertions
there. The `faq` dark-boot check moves to `settings`, which already switches
appearance. Update `walks.test.cjs`'s fixtures and the README's walk count.

## Acceptance criteria

- [ ] `support/walks.cjs` lists 16 walks; `today`, `fresh`, `quiet`,
      `obsidian` and `faq` are gone from it and from edge.cjs/edge.sh.
- [ ] The item's Notes list, per retired walk, every assertion it made and
      the unit test or kept-walk line that makes it now; all of those tests
      exist and pass before the walk is removed.
- [ ] The walks step on the PR's macOS run is under 300 s.
- [ ] Layout scan: per retired walk, the views it scanned (from APP-266's
      table) and the kept walk that scans them now are named in Notes:
      today's Today-card stages in `store` and `connectors`, fresh's empty
      states and notices in `checkin`'s launch, quiet's views in `checkin`,
      obsidian's vault sheet in `connectors`, faq's sidebar, account menu,
      FAQ view and dark boot in `settings`. No view scanned before this
      change is unscanned after it; a retirement whose views have no kept
      home does not merge.

## Notes

- Workstream B3 of the test-pyramid plan. Expected saving: 118 s of serial
  walk time and five Electron boots. The second round is APP-270.
- Since XC-080, a walk that fails once is retried; a retired walk also
  retires its share of the flake budget XC-083 is measuring.
