---
id: XC-059
title: Open a store without Cloudflare or a wallet for card-only sellers
priority: P1
effort: L
component: cross-cutting
status: ready
related: [XC-039, MON-025, APP-136]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

A seller who only wants card payments still has to create a Cloudflare
account and paste a wallet address before their store opens. They need
neither, because Stripe already pays them out to their bank. The Oct 6
new-seller audit found this was where a new seller was most likely to give up.

## Proposed approach

- Host card-only stores on Lore's shared Worker (the hosted-nodes design in
  DOC-003, open PR #371), so opening a store needs no Cloudflare sign-in.
- Make the wallet optional whenever cards are on. Agents that pay over x402
  aren't offered until the seller adds a wallet.
- Let a seller move to their own Cloudflare account later without changing
  their store address.

## Acceptance criteria

- [ ] A new seller can open a store and sell by card with only a Stripe account
- [ ] No wallet prompt appears when cards are on; adding one later turns on agent payments
- [ ] Settings says where the store is hosted in plain words

## Notes

Filed from the 2026-10-06 new-seller audit. Builds on the go-live-on-its-own
PR (APP-139), so price and payment changes reach a hosted store without a push.
