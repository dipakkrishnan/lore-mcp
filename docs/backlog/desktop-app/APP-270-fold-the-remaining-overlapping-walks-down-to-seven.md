---
id: APP-270
title: Fold the remaining overlapping walks down to seven
priority: P1
effort: L
component: desktop-app
status: ready
related: [APP-266, APP-267, APP-268, APP-269, APP-271, XC-084, XC-108]
blockers: [APP-269]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

After APP-269, 16 walks remain, and the 2026-10-29 survey of edge.cjs shows
they still overlap heavily: `store`, `update` and `settings` all exercise the
changes sheet and the store card; `schedule` and `reading` share the stand-in
reading and the same notification, badge and Today-card checks; `jobs` and
`sales` both assert Activity rows; `sell`'s only Electron-specific check is
the preview window's `webPreferences`; `feedback`, `cards` and `provision`
assert async and state rules reachable through a fake `window.lore` and the
APP-267 factory; `automations` drives `routines.cjs`'s Schedule and
`AFTER_RUN` rules through a window. Each walk is an Electron boot and a seed
on a 3-vCPU runner.

## Proposed approach

Fold to seven walks, each running one journey, the Electron-only checks and
one layout scan per view: `agents`, `connectors`, `store`, `checkin`,
`routines`, `settings`, `seller`. Moves: `update` and the changes-sheet
checks into `store`; `schedule` and `reading` into one `routines` walk;
`jobs` and `sales` Activity-row checks into unit tests, with the sale
notification path inside `checkin`; `sell`'s preview-window check into
`store`; `feedback`, `cards` and `provision` into unit tests against the fake
`window.lore` and `ipc.cjs`; `automations` into `routines` once its Schedule
and `AFTER_RUN` rules are in `ipc.test.cjs`. Rewrite APP-266's table for the
seven-walk set; that version is the input XC-108's guard reads.

## Acceptance criteria

- [ ] `support/walks.cjs` lists exactly seven walks: agents, connectors,
      store, checkin, routines, settings, seller.
- [ ] Notes list, per folded walk, every assertion and where it lives now;
      all replacing tests exist and pass before the walk is removed.
- [ ] The walks step on the PR's macOS run is under 200 s, and the kept
      walks' `seconds` estimates in walks.cjs are refreshed from that run.
- [ ] APP-266's table is rewritten for seven walks and its staleness test
      passes.
- [ ] Layout scan: named transfers in Notes, from APP-266's table: update to
      `store`; schedule to `routines`; jobs' and sales' Activity rows to
      `settings`' Activity tab; sell's header button and paste sheet to
      `store` (the preview window is never scanned, only its webPreferences
      asserted); feedback's sheet to `settings` via the account menu; cards'
      Stripe rows and under-minimum warning to `store`; provision's banner
      and Try again to `checkin`'s launch; automations' tab, rows and edit
      sheets to `routines`. No view scanned before this change is unscanned
      after it.

## Notes

- Workstream B4 of the test-pyramid plan. The 150 s walks target and the
  5-minute macOS job are met by this item together with APP-271.
- `agents` keeps `solo: true` (XC-084) until the XC-083 reading says it can
  share the runner again.
