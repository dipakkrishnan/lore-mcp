---
id: APP-069
title: Say which thread is waiting when the composer is locked
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-070, APP-053]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

One agent turn runs at a time, and a card waiting in any thread locks the
composer everywhere. On Today the bar just reads "Lore is working…" and stays
disabled while the store thread is actually waiting on the owner's answer, so
the owner sees a dead input and a "Needs you" row with no link between them
(dogfood 2026-09-04: "why can I not chat? seems blocked").

## Proposed approach

When the lock is caused by a pending card in another thread, the placeholder
names it: "Lore is waiting on you in Open your store." When a turn is
genuinely running, keep "Lore is working…" but hide the mic, attach and send
controls rather than showing them disabled (`syncComposer`,
`renderer.js:801`).

## Acceptance criteria

- [ ] With a card pending in the deploy thread, the Today composer names the
      thread and the Needs-you row opens it.
- [ ] A running turn never shows enabled-looking controls that do nothing.

## Notes

APP-070 removes most of the lock; this item makes the remaining one honest.
