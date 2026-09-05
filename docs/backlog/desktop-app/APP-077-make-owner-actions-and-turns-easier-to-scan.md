---
id: APP-077
title: Make owner actions and turns easier to scan
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-050, APP-075]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

The memory sheet's Rename, Edit, and Draft for sale controls read like one
undifferentiated strip of navigation. In task conversations, owner and Lore
turns also share nearly the same open layout, so longer exchanges take extra
work to scan.

## Proposed approach

Give each memory action a distinct leading line icon while retaining its text
label. Render owner turns as subtle right-aligned bubbles while leaving Lore's
marked replies open on the left.

## Acceptance criteria

- [x] Rename, Edit, and Draft for sale retain their text labels and each have
      a distinct decorative icon.
- [x] Owner turns render as right-aligned bubbles while Lore turns retain the
      existing open treatment.
- [x] The packaged renderer edge check covers both distinctions.

## Notes

Requested during owner dogfooding.

Completed with three static inline icons and CSS-only turn differentiation;
the seller edge flow checks both and captures them for visual review.
