---
id: MON-030
title: Give sellers a refund path and buyers clear terms before card disputes arrive
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-018, MON-028]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

With card checkout the seller is the merchant, so disputes and refunds are
theirs. Agent purchases invite a new kind of friendly fraud: "my agent
bought this and I didn't mean to." A dispute costs the seller a fee (about
$15, unverified) on top of losing a $1–5 sale, and too many disputes can get
a Stripe account restricted. Today the page shows no refund terms, and Lore
has no refund action anywhere.

## Proposed approach

- Show short refund terms on the piece page and in Checkout, which supports
  custom text and a terms link.
- Add a one-click "Refund" for a sale in the desktop Sales list. It goes
  through the checkout endpoint with the connected account.
- Record refunds in `sales`.
- Consider automatic refunds on request within a short window, since a
  refund costs far less than a dispute.

## Acceptance criteria

- [ ] Refund terms appear on `/p/<id>` and in Checkout.
- [ ] In test mode, an owner can refund a card sale from the desktop app, and
      the sale row shows the refund.

## Notes

Raised 2026-09-29. Depends on card checkout (XC-039, PR #345). Check
Stripe's current dispute fee, and how Link's one-time virtual cards behave in
disputes.
