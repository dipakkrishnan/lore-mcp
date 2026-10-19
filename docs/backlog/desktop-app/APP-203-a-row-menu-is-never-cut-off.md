---
id: APP-203
title: A row menu is never cut off
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-200, APP-201]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-15
updated: 2026-10-15
---

## Problem

On the last row of a card, like the Evening check-in in Automations, the ⋯
menu was cut off at the card's bottom edge. Dipak, with a screenshot: "this
is buggy".

## Proposed approach

The card clips its rows to its rounded corners, so while a row menu is open it
lets its contents overflow.

## Acceptance criteria

- [x] The last row's menu shows every item whole, and each one is clickable.
- [x] Closed, cards still clip to their corners.

## Notes

Oct 15, done: `.card:has(.row-menu[open]) { overflow: visible; }`. The
`automations` edge scenario checks that each menu item is the element at its
own point.
