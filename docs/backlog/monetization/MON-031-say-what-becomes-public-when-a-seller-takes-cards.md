---
id: MON-031
title: Tell sellers and buyers what card checkout makes visible about them
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-025, MON-030]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

As merchants, sellers expose more than they may expect. Their name or
statement descriptor appears on buyers' card statements, and Stripe requires
a public support email or phone on receipts. On the buyer side, Checkout
collects an email that the seller will see. For pieces like "how I got
through a layoff", that matters. x402 buyers and sellers are pseudonymous
today, so card checkout is a real change in privacy.

## Proposed approach

- During Stripe onboarding, set a statement descriptor prefix such as
  `LORE* <handle>`.
- Before a seller connects, show a plain list of what becomes public.
- Collect only the buyer data Checkout requires (email; no name or address).
- Say on the piece page what the seller will see about the buyer.

## Acceptance criteria

- [ ] The onboarding screen lists, in plain words, what becomes public.
- [ ] A test purchase shows the Lore-prefixed descriptor and collects no
      buyer data beyond email.

## Notes

Raised 2026-09-29. Check which public-details fields Stripe requires for
individual accounts under Connect.
