---
id: APP-185
title: Say where each sale's money went and link a dashboard the seller can open
priority: P2
effort: S
component: desktop-app
status: ready
related: [MON-018, XC-039, MON-037]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Sales rows don't say where the money went: to the bank through Stripe, or to
the wallet. The "Stripe ↗" link goes to dashboard.stripe.com
(`app/desktop/src/renderer.js` ~line 934 and ~1054), which a seller with an
Express account may not be able to sign in to.

## Proposed approach

- End each sale row with "To your bank via Stripe" or "To your wallet".
- Link card sales to the seller's Express dashboard (a Stripe login link
  created by Lore's checkout service) instead of dashboard.stripe.com.

## Acceptance criteria

- [ ] Every sale row says where the money went
- [ ] The Stripe link opens a page an Express seller is signed in to

## Notes

Filed from the 2026-10-06 new-seller audit.
