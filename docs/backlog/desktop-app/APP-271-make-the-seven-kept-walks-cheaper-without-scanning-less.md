---
id: APP-271
title: Make the seven kept walks cheaper without scanning less
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-266, APP-270, XC-072, XC-084, STO-006]
blockers: [APP-270]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

The walks' time is mostly fixed cost, not assertions. Across the 21 walks the
2026-10-29 survey counted 186 `sleep()` call sites worth about 81 s plus
31.5 s of start-up sleeps (edge.cjs:949 `sleep(2500)`, :1043 `sleep(3500)`,
:1970 `sleep(3000)`, :2591 and :2600 `sleep(2500)` twice), a 1.5 s sleep
before anything in every walk (edge.cjs:666), and stand-in delays of 6-7 s
in the reading and check-in fixtures (edge.cjs:221-240). Every `shot()` runs
SETTLE and a full-DOM LAYOUT pass; `agents` takes 39 screenshots, so 78
layout passes, and the seven walks in the 900 px set do it all twice. The
renderer's `load()` fans out nine IPC calls at once (renderer.js:4353), about
five of them `uv run lore` spawns, and every `changed` event triggers another
load: `agents` makes 258 app CLI calls in one walk (walks.cjs:25).

## Proposed approach

Replace fixed `sleep()`s with `waitFor` on the state each one waits for;
keep a sleep only where the thing waited on is wall-clock by design and say
so in a comment. Scan layout once per view per walk at 1280 px, and once per
view at 900 px for the narrow set, instead of once per screenshot; keep the
screenshot calls that document a state but let them skip the scan. Cut
`agents`' CLI calls by batching the `load()` fan-out into one `snapshot`
IPC, or caching snapshot reads within a tick, whichever the renderer bears
without a redesign. Shorten the stand-in fixtures' delays where the test
only needs ordering, not duration.

## Acceptance criteria

- [ ] `grep -c 'sleep(' app/desktop/support/edge.cjs` falls by at least half
      and each remaining sleep has a comment naming what it waits for.
- [ ] `agents` finishes in 100 s or less on the macOS runner over three
      consecutive green main runs.
- [ ] The walks step is 150 s or less over three consecutive green main
      runs, with seven walks and no retries counted as passes.
- [ ] Layout scan: every view in APP-266's seven-walk table is scanned at
      least once per walk at 1280 px, and every view in the narrow set once
      at 900 px; Notes list, per walk, which `shot()` calls became
      scan-only, which were removed, and why no view lost its scan.
      Screenshots may be dropped; scans may not.

## Notes

- Workstream B5 of the test-pyramid plan, and the item most able to lose
  layout coverage quietly, because "once per view" is a reduction of the
  scan itself. The rule above is the whole point of APP-266's table.
- XC-072's condition waits are the same idea applied to flakes; where a
  `waitFor` replaces a sleep that XC-072 also names, do it once.
