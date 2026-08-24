---
id: APP-034
title: A push shows its receipt
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-006, MON-013, APP-031]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

"Push now" works but gives no indication that it did (Dipak, 2026-08-23):
the card vanishes, the deploy runs for seconds with no working state, and
nothing says what changed. The one action that makes content reachable by
paying strangers ends in silence.

## Proposed approach

Three states on the seam card: the button reads "Pushing…" (disabled)
while `lore push` runs; on success the card is replaced by a quiet
confirmation line — "Pushed · N publications live on your node ↗" with
the store address — that the next render can drop; failures already
surface through the existing error path. Same treatment for the Store
view's push affordance when MON-013 drift lands.

## Acceptance criteria

- [ ] Push shows a working state while running.
- [ ] Success states what is now live, with a link to the store.
- [ ] Failure keeps the card and shows the reason (existing behavior).
