---
id: MON-032
title: Prepare sellers and support for Stripe payout holds and account reviews
priority: P2
effort: S
component: monetization
status: in-review
related: [MON-030, MON-031]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

Many small purchases by automated agents look unusual to fraud systems, so
Stripe may hold a new seller's first payouts or review the account. Sellers
will blame Lore rather than Stripe, so support lands on Lore even though Lore
never holds the money. Nothing in the app explains payout timing or holds.

## Proposed approach

- Show the connected account's payout status in the desktop app: the next
  payout, any holds, and any outstanding requirements.
- Link to the seller's Stripe dashboard.
- Write a short support runbook: when the first payout arrives, what an
  account review means, and where the seller responds to it.

## Acceptance criteria

- [ ] For a connected test account, the desktop app shows payout status and
      any outstanding Stripe requirements.
- [ ] A support runbook exists under `docs/`.

## Notes

Raised 2026-09-29. Depends on card checkout (XC-039, PR #345).
