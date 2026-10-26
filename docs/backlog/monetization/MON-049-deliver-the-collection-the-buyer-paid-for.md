---
id: MON-049
title: Deliver the collection the buyer paid for, not what is left of it
priority: P1
effort: M
component: monetization
status: ready
related: [MON-044, XC-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

A buyer starts card checkout for a two-piece collection, then the seller removes a piece before the payment settles. Settlement reloads the collection's current members (`collectionCopy` in `lore/node/src/collections.ts`) and delivers the one piece left. Since that copy isn't empty, the sale is recorded as normal at the full price, with no refund owed.

Found by the Codex review of v0.1.19 (Oct 25) and deferred past launch.

## Proposed approach

Record the member piece ids on the checkout session when it starts. At settlement, deliver exactly that set. If any piece is gone, mark the sale refund-owed.

## Acceptance criteria

- [ ] A collection changed mid-checkout delivers the set that was paid for, or is marked refund-owed
- [ ] An unchanged collection settles as it does today
