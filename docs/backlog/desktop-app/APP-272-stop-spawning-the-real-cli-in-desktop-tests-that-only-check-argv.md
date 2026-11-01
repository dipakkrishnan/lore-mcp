---
id: APP-272
title: Stop spawning the real CLI in desktop tests that only check argv
priority: P2
effort: S
component: desktop-app
status: ready
related: [APP-248, STO-006, XC-097]
blockers: [XC-097]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

About 37 of the desktop's 169 node:test tests spawn the real `lore` CLI
through the `attended_cli.py` shim in `support/scratch.cjs` (roughly 21 in
`test/store.test.cjs`, 7 in `app`, 6 in `agent`, 3 in `sandbox`). Each spawn
pays about 0.4 s to start Python and import `lore.cli` even after STO-006.
Most of those tests assert only the argv the app built or the state file it
wrote afterwards, which `test/state-cli.test.cjs` already proves with a shell
stub and no `uv` at all. Locally `store.test.cjs` takes 10.3 s and
`agent.test.cjs` 9.5 s, nearly all of it spawns. The real sandbox tests in
`sandbox.test.cjs` (21.2 s, 13 processes, darwin-gated) are a different
case: they test the sandbox itself.

## Proposed approach

Classify the ~37 CLI-spawning tests. Where the assertion is about argv,
ordering or the resulting state file, switch the test to the fake `lore`
binary pattern from `state-cli.test.cjs` and move it to `test/unit/`. Keep
about five real round trips (one per CLI surface the app depends on: push,
sources, publications, agents, desktop-state) as `test/component/` tests, so
the shim and the real parser are still exercised once each. Leave the
sandbox tests as component tests, darwin-gated as today.

## Acceptance criteria

- [ ] `test/unit/` holds every former CLI test whose assertion is argv or
      state; none spawns `uv`.
- [ ] `test/component/` keeps no more than six real-CLI round trips, named
      in Notes with the surface each one covers.
- [ ] `npm test` in `app/desktop` is under 30 s on the macOS runner (today
      42 s) with the same assertion count.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream B6 of the test-pyramid plan. Blocked on XC-097 for the
  `test/unit/` and `test/component/` folders.
