---
id: APP-137
title: Give Today one next step instead of five equal ones
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-136, APP-138, APP-139]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Today's "Needs you" lists up to five rows with the same orange dot and the
same secondary button (Connect, Connect your agents, Paste, Publish, Push or
Redeploy), plus a separate "Open your store?" card. Two pairs nearly
overlap. A first-time seller can't tell which one matters. Found in the
Oct 5 whole-app UX review (`seller--seller-approved-offer.png`).

## Proposed approach

One "Next step" card with one primary button, chosen along the seller's
path: bring something in → approve → open store → get paid → first sale.
Everything else sits in a collapsed "Setup · 2 of 5" checklist. Merge
"Sell something you wrote" and "Publish something" into "Draft something to
sell", which asks whether to paste writing or pick from memories. Fold the
"Open your store?" card into the Next step. Inspiration: Stripe Dashboard
setup guide, Linear onboarding.

## Acceptance criteria

- [ ] Today shows at most one primary action at a time.
- [ ] The remaining setup steps are in a collapsed checklist with a count.
- [ ] One "Draft something to sell" entry replaces Paste and Publish.
