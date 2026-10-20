---
id: APP-135
title: Say when Stripe is checking, look again on its own, and price per piece
priority: P1
effort: S
component: desktop-app
status: completed
related: [XC-039, MON-028]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-04
updated: 2026-10-19
---

## Problem

Found in Dipak's first run of "Get paid to your bank": after finishing Stripe's
form, Settings said "Stripe still needs a few details" while Stripe was only
verifying what he entered, and it didn't change until he clicked back into
the window. Prices read "$3.00 publication" and "what a buyer's agent pays per
read", which no longer fits card buyers.

## Proposed approach

Checkout's account status also says whether Stripe is still checking (every
open requirement awaits Stripe) or waiting on the seller. Settings says
"Stripe is checking your details" with no action, and looks again every 10
seconds until Stripe answers; "Needs you" keeps Finish with Stripe. Prices
read "$3.00 per piece".

## Acceptance criteria

- [x] Checking and needs-you are told apart, and checking clears without a click.
- [x] Prices say per piece and who pays.

## Notes

**Completed (verified 2026-10-19):** every acceptance criterion is checked and the work is on main in 2d48761. Status was left stale after merge; closed out in the review-queue pass.
