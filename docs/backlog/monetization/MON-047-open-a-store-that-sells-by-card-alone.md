---
id: MON-047
title: Open a store that sells by card alone, with a payout address optional
priority: P0
effort: S
component: monetization
status: in-review
related: [XC-039, MON-025, MON-028, XC-069]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-19
updated: 2026-10-19
---

## Problem

Opening a store for sale required a crypto payout address. Buyers can already pay by card on a piece's page, including their agents in a browser. The Worker already sells by card alone when it has no wallet (`sellByCardOnly`). But two things blocked it:

- `lore node deploy` refused a full deploy without `LORE_WALLET`.
- The app's open-store flow always asked for an address.

The owner asked for this at launch (Oct 19): an address shouldn't be the price of selling.

## Proposed approach

- `lore node deploy` with no `--wallet` succeeds when card payments are on (`stripe_account` set). The store opens selling by card alone. The refusal stays, in plain words, when there's neither a wallet nor card payments.
- `payout.json` records the network of a card-only store, which has no address, so a redeploy keeps it on the same network.
- If card payments are on and no address is recorded, the app's `openStore` asks for neither a network nor an address. It deploys on real money, or on the network last recorded. The confirm card lists "Payments: By card" and "Paid to: Your bank, through Stripe".
- The payout card leads with **By card** (recommended). Choosing it opens Stripe's form and waits until Stripe clears the owner, then turns card payments on, as Settings › Get paid does, and opens the store. A Coinbase account or a wallet app's address remain as alternatives.
- In lore-enable-payments, the desktop order calls `open_store` with no address and lets the app ask.

## Acceptance criteria

- [x] A full deploy with card payments on and no wallet opens the store selling (pytest).
- [x] With neither a wallet nor card payments, the deploy refuses in seconds and names both ways out.
- [x] With card payments on, `openStore` asks nothing and deploys `node deploy --network real` (desktop test).
- [x] "By card" on the payout card opens the store only once card payments are on (desktop test).
- [ ] Live: a new owner opens a store by card alone, and a card purchase on a piece page pays their Stripe account. This needs the owner's own Stripe and Cloudflare.
