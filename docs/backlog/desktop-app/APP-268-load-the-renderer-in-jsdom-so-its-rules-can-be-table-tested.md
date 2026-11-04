---
id: APP-268
title: Load the renderer in jsdom so its rules can be table-tested
priority: P1
effort: M
component: desktop-app
status: completed
related: [APP-063, APP-064, APP-266, APP-269, APP-270, APP-283, XC-097]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-04
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

- [x] `support/renderer-harness.cjs` loads renderer.js in jsdom with a fake
      `window.lore`; a smoke test proves `boot()` runs and the first `load()`
      issues the nine IPC calls renderer.js:4353 makes today.
      (`test/unit/renderer-harness.test.cjs`: the nine reads, in order, after
      `agentStatus` and `firstRun`, then `memoriesSeen` and `usage`.)
- [x] `nextStep` takes its inputs as parameters and has a table test for
      stages a-f that mirrors what the `today` walk asserts.
      (`nextStep(s, state = stepState())`; `renderer-next-step.test.cjs`,
      24 staged rows plus the ordering and detail tests.)
- [x] The notice state machine, Activity row formatter, update-button state,
      price-sheet validation, FAQ wording and account-menu rules each have a
      unit test file under `test/unit/`. (`renderer-notices`,
      `renderer-activity`, `renderer-update`, `renderer-price-sheet`,
      `renderer-faq`, `renderer-account-menu`.)
- [x] The whole renderer unit tier runs in under 5 s locally. (148 tests in
      eight files: 1.3 s wall on a 10-core Mac, about 0.5 s per file alone; a
      harness `load()` is 75 ms.)
- [x] The harness README says it checks DOM and text, never layout, and
      points at APP-266's table for what does. (`app/desktop/README.md`,
      the paragraph before the `shot()` one; it points at
      `support/views.json`.)
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it. (No change under
      `support/` but the new harness; `support/walks.cjs`, `edge.cjs` and
      `views.json` are as main has them.)

## Notes

- Workstream B2 of the test-pyramid plan. APP-269 retires the walks whose
  assertions these tests take over; it is blocked on this item.
- Known jsdom gaps from the survey: `showModal` (3 uses), popover,
  `getAnimations`, layout calls (`getBoundingClientRect`,
  `elementsFromPoint`), `matchMedia`, the observers, `AudioContext` and
  `getUserMedia` for dictation. Stub what the rules under test need; leave
  dictation out.
- Done in PR #647 (2026-11-04). What jsdom 30.1.3 actually lacks, stubbed in
  the harness: every `HTMLDialogElement` method (`show`, `showModal`,
  `close`), the popover API (`showPopover`/`hidePopover`/`togglePopover`,
  marked with `data-popover-open` and a `toggle` event, since `:popover-open`
  cannot match), `scrollIntoView`, `getAnimations`/`animate`, `matchMedia`,
  `ResizeObserver`, `IntersectionObserver`; `document.hasFocus()` is false,
  so the harness answers true. `getComputedStyle`, `requestSubmit`,
  `localStorage` (with an http: URL) and `requestAnimationFrame` are there.
- The scripts run through `vm.runInContext` on jsdom's own context, not
  `window.eval`: only a classic script puts top-level `let`s in the global
  lexical scope where later code (and edge.cjs's `executeJavaScript`) can
  reach them. The harness reads index.html's `<script>` list, so APP-283's
  `inbox.js` and `memorytext.js` loaded without a change here.
- The rules now take state: `nextStep(s, state = stepState())` and
  `underWay(kind, state)`; `recent(iso, now)`; `activityRuns(items)` and
  `activityRow(run, now)` split out of `recentRuns`; `withNotice(items,
  notice)` and `shownNotices(items, today)` out of `tell`/`renderNotices`;
  `updateButton(update)`; `priceEntry(raw, rawCopies)`; `faqPrice(usd)`;
  `accountState(status, snapshot)`. Every default reads the live global the
  function read before, so no caller changed.
- APP-283 (Inbox replaces Today) and APP-288 (Automations into Connectors)
  landed while this was open. `nextStep` is unchanged by them; the Inbox
  draws its result as an `.irow.step` row with the action as the verb rather
  than a card, and the automations notice now says "Change this in
  Connectors". The tests say Inbox where they mean the view; the walk is
  still named `today`.
- A `node:test` `after()` hook registered from inside a running test attaches
  to that test, not the file. The harness registers its close-all-windows
  hook as it is required, or a file with no top-level `load()` sits out the
  first-run read's 5 s timer after its last test.
