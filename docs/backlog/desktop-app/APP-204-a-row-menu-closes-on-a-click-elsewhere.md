---
id: APP-204
title: A row menu closes on a click elsewhere
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-200, APP-203]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-15
updated: 2026-10-15
---

## Problem

Dipak: "When I click the 3 dots, if I click outside of it, it doesn't close."
The ⋯ menu was a `<details>`, which only closes from its own toggle.

## Proposed approach

Use the browser's popover (`popover="auto"`). It closes on a click elsewhere
or on Escape, and draws in the top layer, so no card can cut it off. CSS
anchor positioning puts it under its ⋯, or above when the window ends first.

## Acceptance criteria

- [x] A click anywhere outside the open menu closes it, and so does Escape.
- [x] Picking an item closes it.
- [x] It opens just below its ⋯, and is never cut off by its card.

## Notes

Oct 15, done. This supersedes APP-203's `.card:has(.row-menu[open])` rule,
which is removed. The `automations` edge scenario now opens the menu from its
⋯ and closes it with a real click outside and with Escape.
