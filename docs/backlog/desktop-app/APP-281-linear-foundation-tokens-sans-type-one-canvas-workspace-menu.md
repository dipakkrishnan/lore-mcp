---
id: APP-281
title: Linear foundation: tokens, sans type, one canvas, workspace menu
priority: P3
effort: M
component: desktop-app
status: completed
related: [APP-256, APP-261, APP-225, APP-282, APP-283, APP-284, APP-285, APP-286]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-13
---

## Problem

The app read as a 2021 Notion template with a serif (Nov 1 UX audit): 17 font sizes, 10 radii, a serif in titles,
rows and the palette, a frosted macOS sidebar beside a green-black canvas, a full-width filled New button and a
"Signed in · Claude · Live" footer. Every screen inherits those, so no screen can meet docs/design-principles.md
until the foundation does.

## Proposed approach

Audit ship-order step 3, one small diff every screen inherits:

- `styles.css` `:root` holds the approved mock's tokens: system sans only, sizes 11/12/13/15/20, radii 4/6/8/12
  (999 for status chips), a 4px spacing grid, shadows and durations; dark first, light from the same names.
  Component rules name tokens; a unit test fails on a raw font size, radius or duration, or any serif.
- One canvas: no window vibrancy; the sidebar is one step up from `--bg`. Cards on the canvas are hairline
  frames; only what floats (menus, sheets, the palette, a peek) is raised.
- Sidebar: a workspace menu at the top-left (Lore ▾ → who is signed in and the store's state, Settings, Help,
  feedback, Dark mode, Sign out) replaces the footer; small find and compose icons replace the search box and the
  New button; New's rows are single-line (icon · label · key) and include Memory. ⌘N opens New.
- The welcome screen and first-run chat keep their behaviour and copy and take the tokens.

## Acceptance criteria

- [x] No serif and no raw font size, radius or duration in a component rule (unit test).
- [x] Main window has no vibrancy; the sidebar and main area share one ramp in dark and light.
- [x] Workspace menu, ⌕ and ✎ at the top of the sidebar; New lists Memory, Collection, Automation as one-line rows.
- [x] Desktop unit tests and walks green; before/after screenshots of every main screen in dark at 1440×900.

## Notes

Nov 2: built against the approved mock's `:root`. Supersedes APP-256's six-step scale. Later steps: APP-282 (lists
to rows), APP-283 (Inbox), APP-284 (object pages), APP-285 (⌘K commands and Settings rows), APP-286 (page header bar).

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Close as completed; the --text-3 contrast gap needs
its own item. Prioritization flag (not acted on): done: #638.

**Close-out (2026-11-13):** Completed by PR #638 (merged 2026-11-02).
Evidence on this branch:
- Tokens and no serif: `app/desktop/test/unit/app.test.cjs` test "APP-281:
  type, radii and timing come from tokens, and the app has no serif" fails on
  any raw font size, radius or duration in a component rule, and on any serif.
- One canvas: `createWindow` in `app/desktop/src/main.cjs` sets no
  `vibrancy` (comment "APP-281: one canvas"); `--bg-side` is one step up from
  `--bg` in both themes in `styles.css`.
- Sidebar: `app/desktop/src/index.html` has the workspace menu (`#account`,
  `#account-menu` with Settings, Help & FAQ, feedback, Dark mode, Sign out),
  the find (`#search`, ⌘K) and compose (`#new-open`, ⌘N) icons, and New as
  one-line rows with Memory, Collection and Automation (plus Writing to sell,
  added later).
- Tests and screens: the PR reports `npm test` 172 pass, walks 20 of 21 (the
  `schedule` failure reproduced on untouched main and CI was green), and
  before/after dark 1440×900 shots of every main screen.
Leftover, not filed: the `--text-3` tertiary-text contrast gap noted in
APP-225's Notes. It belongs with APP-225 (dark mode, in-review) or a small
item of its own.
