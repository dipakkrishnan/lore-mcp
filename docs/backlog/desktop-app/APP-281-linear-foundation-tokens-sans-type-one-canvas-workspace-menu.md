---
id: APP-281
title: Linear foundation: tokens, sans type, one canvas, workspace menu
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-256, APP-261, APP-225, APP-282, APP-283, APP-284, APP-285, APP-286]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-02
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

- [ ] No serif and no raw font size, radius or duration in a component rule (unit test).
- [ ] Main window has no vibrancy; the sidebar and main area share one ramp in dark and light.
- [ ] Workspace menu, ⌕ and ✎ at the top of the sidebar; New lists Memory, Collection, Automation as one-line rows.
- [ ] Desktop unit tests and walks green; before/after screenshots of every main screen in dark at 1440×900.

## Notes

Nov 2: built against the approved mock's `:root`. Supersedes APP-256's six-step scale. Later steps: APP-282 (lists
to rows), APP-283 (Inbox), APP-284 (object pages), APP-285 (⌘K commands and Settings rows), APP-286 (page header bar).
