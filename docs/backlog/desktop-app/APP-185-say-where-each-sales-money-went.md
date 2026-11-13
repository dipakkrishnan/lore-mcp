---
id: APP-185
title: Say where each sale's money went and link a dashboard the seller can open
priority: P3
effort: S
component: desktop-app
status: in-review
related: [MON-018, XC-039, MON-037]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-12
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

**Prioritization (2026-11-12):** Priority P3 (was P2). Moved back from ready
to in-review. Before it can be ready: Drop the Express criterion. Decide
whether "by card" / "by an agent" on sale rows (saleRow, now in Inventory's
Sales group) should read "to your bank via Stripe" / "to your wallet", and
where; otherwise mark obsolete. Prioritization flag (not acted on): partly
obsolete: the Express-dashboard premise doesn't hold.
