---
id: APP-228
title: A sleeker account menu, with icons and who is signed in at the top
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-225, APP-218]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-19
updated: 2026-11-12
---

## Problem

The account menu at the foot of the sidebar was a plain list of text rows,
with the account line buried between Dark mode and Sign out. Next to the
rest of the app it looked dated (owner feedback, Oct 19).

## Proposed approach

Lay it out the way the ChatGPT and Claude account menus are: who is signed
in first, as a quiet line, then Settings, Help & FAQ, Report feedback and
Dark mode, each with a 16px icon in the sidebar's stroke style. A divider
comes next, then a muted Sign out. The rows are tighter, the corners and
shadow match the app's sheets, and the Dark mode switch stays one click.

## Acceptance criteria

- [x] Every item has an icon, and the signed-in line comes first.
- [x] Sign out reads "Sign out"; the line above it already names the provider.
- [x] Looks right in light and dark; the faq and settings walks pass in both.

## Notes

- Oct 19: screenshots checked in both themes.

**Backlog audit (2026-11-12), closed as completed:** The menu shipped in PR
#503 and has been green on main ever since. The `faq` walk named in the
third criterion was retired by APP-269 and APP-270; its dark scan moved to
the `checkin` walk and its menu rules to renderer-account-menu.test.cjs,
which passes. The item was never moved off in-review after it merged, so it
is now closed as completed.
