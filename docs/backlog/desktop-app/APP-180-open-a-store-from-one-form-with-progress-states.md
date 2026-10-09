---
id: APP-180
title: Open a store from one form with progress states, not an agent chat
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-136, APP-057, APP-056]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

"Open your store" starts an agent conversation (`startDeploy` in
`app/desktop/src/renderer.js`, ~line 2138, driven by the desktop section of the
`lore-enable-payments` skill). A new seller has to read and answer chat turns
to fill in what is really a form: price, how to get paid, then go. The chat
also doesn't show how far along the deploy is.

## Proposed approach

- One card with the price, the By card / wallet choice and an Open button.
- After Open, the card shows named steps (Preparing, Uploading pieces, Checking
  the store is live, Open), each with a plain failure line and Try again.
- Keep the agent route for owners who type "open my store", and trim the
  skill's desktop section to point at the card.

## Acceptance criteria

- [ ] Every "Open your store" button opens the card, not a chat thread
- [ ] The card shows each step and ends on the store address with Open ↗
- [ ] A failed step says what failed and offers Try again

## Notes

Filed from the 2026-10-06 new-seller audit (renderer.js ~2020/2652 are the
other entry points). Pairs with XC-059: for a card-only seller the card should
need nothing beyond the price.
