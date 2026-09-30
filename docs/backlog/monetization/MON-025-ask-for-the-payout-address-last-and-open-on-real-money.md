---
id: MON-025
title: Ask for the payout address last, and open the store on real money
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-024, MON-022, MON-026, XC-024, APP-057, APP-098]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-14
updated: 2026-09-28
---

## Problem

Zane, the first trial user, stopped at the wallet: "doesn't let me set up
store until I have my payout wallet". The Today rail offered "Open your
store" before he had approved anything, and its first sentence was "A payout
address, a price, and a node on the test network first". Opening a store
asked for three unfamiliar things before he had seen any value: a
self-custody wallet, then later two Coinbase Developer Platform API secrets
for real money, then a switch from play money that no buyer ever uses. A
play-money store cannot be listed on the marketplace, so for a seller it
only adds a second decision.

The first version of this item (a play-money store with no wallet) was
dropped on 2026-09-27: it moved the wallet from store setup to the
real-money switch, which every seller must still pass, one screen later.

## Approach

- **Wallet last, after value.** The "Open your store" rung appears only once
  the owner has an approved publication, whatever rung setup is on. The
  desktop task runs price, Cloudflare sign-in, then the payout address.
- **Real money only in the app.** The desktop store deploys with
  `--network real`. The test network stays for terminal developers and CI.
  Settings keeps "Switch to real payments" only for a store opened earlier
  on the test network; "Switch to play money" is gone.
- **No Coinbase developer keys.** Mainnet settles through PayAI's keyless
  facilitator (`facilitator.payai.network`, whose `/supported` lists x402 v2
  `exact` on `eip155:8453`). A full CDP pair still overrides it; half a pair
  refuses to start. A facilitator only submits the buyer's signed transfer,
  which fixes recipient and amount, so custody is unchanged. `store_secret`
  and its plumbing are removed from the app.
- **One guided payout card.** An `evm_address` question renders a fixed
  card: "My Coinbase account" (recommended: reaches a bank without a wallet
  app) or "A wallet app", each with its exact taps and the Base network
  check, a field that confirms the address it got, and a guard that clears
  anything shaped like a recovery phrase.
- **The moment it opens.** The finished store card says what is on sale, at
  what price, and the address every payment lands at.

## Acceptance criteria

- [x] "Open your store" is not offered before an approved publication.
- [x] The desktop skill orders price → Cloudflare → payout address → deploy
      on real money, with no test payment and no CDP step (pinned in
      `tests/test_skill_contract.py`).
- [x] Mainnet with no CDP credentials settles through the keyless
      facilitator; half a pair fails closed (`lore/node/test/network.test.ts`).
- [x] A redeploy never re-asks for an address already on the node (MON-024).
- [ ] A 1¢ purchase on Dipak's real-money node settles to a Coinbase
      account's USDC-on-Base deposit address and shows in that account.
      Human-gated; ship the Coinbase-first card only after it passes.
- [ ] Zane opens a store from v0.1.3 without stalling at the address.

## Notes

Zane's custodial suggestion ("you can also probs access significant cash
flow this way") is recorded and declined; the non-custodial line stays.
The buyer side of the same gap is MON-026 and MON-027.
