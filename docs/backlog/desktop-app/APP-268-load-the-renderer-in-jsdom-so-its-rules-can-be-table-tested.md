---
id: APP-268
title: Load the renderer in jsdom so its rules can be table-tested
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-063, APP-064, APP-269, APP-270]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

`app/desktop/src/renderer.js` is 6,350 lines in one classic script: about
226 top-level bindings, 257 top-level functions, over 60 mutable globals
(`snapshot`, `auth`, `view`, `taskItems`, `busy`, `pushOffer`, ...), and
`boot()` at the end. Its rules are tested only by driving a live window:
`today` exists to check `nextStep` (renderer.js:819-837) through six seeded
stages; `fresh` to check the notice state machine (~4363-4409) with injected
failures; `faq` for the sidebar, account menu and FAQ wording; `jobs` and
`sales` for Activity row formatting; `settings` for update-button states;
`store` for price-sheet validation. Each costs an Electron boot, seeding and
screenshots to assert what is, underneath, a function of state. The renderer
reaches main only through `window.lore` (about 80 members, pinned by
`test/ipc-contract.test.cjs`), so a fake of that one object is the whole
boundary. `test/boundary.test.cjs` (APP-063) already loads renderer pieces in
`node:vm`, and edge.cjs relies on the top-level bindings being reachable from
another script, so loading the file whole is feasible.

## Proposed approach

Add `jsdom` as a dev dependency. Write `support/renderer-harness.cjs`: load
`src/index.html` into a jsdom window, install a `marked` stub, a recorded
fake `window.lore` generated from the `Window.lore` interface in
`src/types.d.ts` (every member a function that records its call and returns
a configurable value), and stubs for what jsdom lacks (`showModal`,
`matchMedia`, `IntersectionObserver`, `ResizeObserver`, `getAnimations`,
`scrollIntoView`), then evaluate renderer.js in that window with `boot()`
deferred. Make the first rules testable by having them take state as
parameters instead of reading globals: `nextStep(state)`, the notice state
machine, the Activity row formatter, update-button state, price-sheet
validation, FAQ wording and account-menu rules. Table-test each in
`test/unit/renderer-*.test.cjs`. The harness README states, in one paragraph,
that it checks DOM structure and text and never layout.

## Acceptance criteria

- [ ] `support/renderer-harness.cjs` loads renderer.js in jsdom with a fake
      `window.lore`; a smoke test proves `boot()` runs and the first `load()`
      issues the nine IPC calls renderer.js:4353 makes today.
- [ ] `nextStep` takes its inputs as parameters and has a table test for
      stages a-f that mirrors what the `today` walk asserts.
- [ ] The notice state machine, Activity row formatter, update-button state,
      price-sheet validation, FAQ wording and account-menu rules each have a
      unit test file under `test/unit/`.
- [ ] The whole renderer unit tier runs in under 5 s locally.
- [ ] The harness README says it checks DOM and text, never layout, and
      points at APP-266's table for what does.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream B2 of the test-pyramid plan. APP-269 retires the walks whose
  assertions these tests take over; it is blocked on this item.
- Known jsdom gaps from the survey: `showModal` (3 uses), popover,
  `getAnimations`, layout calls (`getBoundingClientRect`,
  `elementsFromPoint`), `matchMedia`, the observers, `AudioContext` and
  `getUserMedia` for dictation. Stub what the rules under test need; leave
  dictation out.
