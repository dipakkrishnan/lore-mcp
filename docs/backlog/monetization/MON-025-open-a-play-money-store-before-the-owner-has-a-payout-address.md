---
id: MON-025
title: Open a play-money store before the owner has a payout address
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-024, MON-022, XC-024, APP-057, APP-098]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-14
updated: 2026-09-14
---

## Problem

The Store rail reads "A payout address, a price, and a node on the test
network first", and `lore node deploy` refuses without `--wallet` on a first
deploy because the Worker fails closed without `LORE_WALLET`
(`lore/deploy.py`, `lore/node/src/wallet.ts`). So a first-time owner meets
the wallet step, the place `XC-024` already identified as where strangers
stall, before they have seen their store exist. Zane stopped there:
"doesn't let me set up store until I have my payout wallet". He suggested
Lore hold the funds until a wallet is connected. Lore's design is
non-custodial by decision (the payments skill: "Lore never holds, custodies,
or can recover these"), and holding other people's money is a
money-transmission question, not a product one. But a play-money store has
no funds to hold.

## Proposed approach

Make the payout address a real-money requirement, not a store requirement.
On `--network test`, `deploy` accepts no wallet and the Worker settles test
payments to a documented Lore-owned test address, so the owner's store opens
with a price, a node, and play money only. The real-money switch (`MON-022`
gates) becomes the step that asks for the address, as one typed card
(`XC-024`), stores `LORE_WALLET`, and redeploys. The rail copy drops the
address from the first sentence and the Settings "Payments" row says where
real money will go once they switch. `MON-024`'s rule still holds: a switch
on a node that already has an address never re-asks.

## Acceptance criteria

- [ ] A fresh owner opens a play-money store with a price and no wallet, and
      a test purchase settles.
- [ ] "Switch to real payments" asks for the payout address exactly once,
      and the Worker refuses to serve real-money paid tools until it is set.
- [ ] Settings shows the payout row only once an address exists, and before
      that says real money needs one.
- [ ] Custody is unchanged: at no point does any Lore-controlled address
      receive real money on an owner's behalf.

## Notes

Zane's custodial suggestion ("you can also probs access significant cash
flow this way") is recorded and declined here; the non-custodial line stays.
