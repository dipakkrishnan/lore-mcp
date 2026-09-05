---
id: APP-076
title: Submit each publication decision once
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-047, APP-055]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

Publication approval cards leave both actions enabled while a decision is in
flight. A double click sends the same draft twice: the first call approves or
skips it, then the second surfaces `that candidate is not drafted; nothing
saved` even though the owner's first action succeeded (dogfood 2026-09-04).

## Proposed approach

Disable both actions as soon as either is chosen, and restore them only if the
same card remains after the decision completes.

## Acceptance criteria

- [ ] A rapid double click sends one publication decision.
- [ ] A failed decision leaves the card actionable for another try.

## Notes

Observed in the existing-user Desktop log after acting on a publication card.
