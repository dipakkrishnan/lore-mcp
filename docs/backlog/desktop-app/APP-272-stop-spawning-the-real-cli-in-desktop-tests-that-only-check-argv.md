---
id: APP-272
title: Stop spawning the real CLI in desktop tests that only check argv
priority: P2
effort: S
component: desktop-app
status: in-progress
related: [APP-248, STO-006, XC-097]
blockers: [XC-097]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
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

- [x] `test/unit/` holds every former CLI test whose assertion is argv or
      state; none spawns `uv`. (40 tests moved: 26 from `store`, the 8 of
      `state-cli`, both of `bids`, `blueprint` and `collections` from `app`,
      the memory card and routines from `agent`. They run against
      `support/fake-cli.cjs`, a CLI that is a function in the test's own
      process, so they spawn nothing at all, not even `sh`; any call a test
      did not answer fails it instead of reaching a real CLI.)
- [x] `test/component/` keeps no more than six real-CLI round trips, named
      in Notes with the surface each one covers. (Six; see Notes. Counted by
      logging the scratch shim: 125 shim spawns in `agent`, `app`, `bids` and
      `store` before, 33 after, all inside those six.)
- [ ] `npm test` in `app/desktop` is under 30 s on the macOS runner (today
      42 s) with the same assertion count.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it. (No change to
      `support/walks.cjs`, `edge.cjs`, `views.json`, `renderer.js` or
      `index.html`; `walks.test.cjs` passes unchanged.)

## Notes

- Workstream B6 of the test-pyramid plan. Blocked on XC-097 for the
  `test/unit/` and `test/component/` folders.
- Premise change: the item said to move these tests to the shell-stub
  pattern of `state-cli.test.cjs`, but XC-097's unit tier starts no process
  (`tiers.test.cjs`), and a shell stub is one; that is why XC-097 left
  `state-cli` in component. So `state.cjs`'s `useRuntime` also takes a
  function (`FakeCli`), which `lore()` and the streamed deploys call in
  place of `execFile`/`spawn`; the app only ever passes a path. No edit to
  `main.cjs` or `ipc.cjs`.
- The six real round trips left in `test/component/`, one per surface:
  desktop-state (`store`: "reads only the fixed APP-001 snapshot"); sources
  (`app`: "connecting an app validates before any CLI call, then
  round-trips..."); marketplace and the push it makes (`app`: "listing
  switches the store on through the CLI..."); agents (`app`: "with no store
  online, connecting an agent..."); publications decide (`agent`: "only
  Electron main can pipe a decision..."), which proves the attended gate and
  the launch key through `scratch.cjs`'s `attended_cli.py`; and publication
  extras (`agent`: "new free parts for a live piece..."). The sandbox tests
  stay component and darwin-gated, as do the stub-binary tests of the spawn
  itself (`useRuntime` runs the packaged binary from the Lore home; a
  streamed command hands back each line); the shim logged no call from
  `sandbox`, `owner`, `walks` or `boundary`.
- What the moved tests no longer assert, because it is the CLI's behaviour
  and the Python suite owns it: the verdict, price, free copies and
  collection reading back in the snapshot; the feedback relay's payload
  (`tests/test_feedback.py`); the profile's saved rhythm after a refusal
  (`tests/test_automation.py`); which fixture bids the CLI matches
  (`tests/test_bids.py`). Two cross-language ceilings the real round trip
  used to hold are now read from the Python source instead:
  `MAX_TITLE` in `lore/capture.py` for the memory card, `MAX_TEXT_LENGTH` in
  `lore/blueprint.py` for the blueprint card.
- Counts, local (10-core Mac, origin/main bdada87f vs this branch): unit
  266 -> 306 tests, 2.5 s -> 2.0 s wall; component 94 -> 54 tests, 33.6 s
  -> 23.1 s wall; `npm test` 360 -> 360 tests (359 pass, 1 todo both times),
  26.0 s -> 25.2 s wall, 82 s -> 57 s CPU. `npm test`'s wall is
  `sandbox.test.cjs`'s (21-23 s alone, 23 tests), which this item leaves
  alone; per file the component tier went `store` 10.7 -> 0.7 s, `agent`
  9.3 -> 6.8 s, `app` 11.9 -> 5.7 s, `bids` 4.4 s and `state-cli` 4.5 s to
  nothing. Unioned desktop coverage stays where it was (lines 93.58%,
  branches 87.57% locally).
