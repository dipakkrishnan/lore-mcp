---
id: MON-054
title: Mark a bid filled only from the payment rail, as a shared record
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-051, MON-046, XC-115]
blockers: []
dependencies: [MON-051]
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

Sellers asked for receipts that both buyer and seller can look at to see that a sale settled.
MON-046 designs a signed public log, but it is XL. Bids need a settlement record from day one
that nobody can fake, Lore included.

## Proposed approach

Follow MON-046's rule from the start: the payment rail is the truth.

- `filled` is set only by checkout's Stripe Connect webhook (card) or by a Base lookup that
  shows a USDC transfer of at least the bid amount to that store's registered `payTo` (x402).
  There is no manual path.
- Bid events are append-only (`opened`, `answered`, `filled`, `expired`, `refunded`). Nothing
  is edited in place.
- The bid page (XC-115) is the shared record. USDC fills link the Base transaction. Card fills
  say "confirmed by Stripe," and the buyer also gets Stripe's emailed receipt. The page states
  that signed public receipts come with MON-046.
- The events use MON-046's record shapes, so the receipts Worker can sign them later without
  a migration.

## Acceptance criteria

- [ ] A card purchase of an answer piece and an x402 purchase each move their bid to `filled` exactly once, with retried webhooks producing no duplicates.
- [ ] An x402 report whose transaction doesn't pay the store the bid amount leaves the bid unfilled.
- [ ] No route, token or admin action sets `filled` except these two.
- [ ] A refund or dispute appends `refunded` and edits nothing.
