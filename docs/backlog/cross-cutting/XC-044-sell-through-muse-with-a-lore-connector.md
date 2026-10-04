---
id: XC-044
title: Sell through Muse with a Lore connector
priority: P1
effort: L
component: cross-cutting
status: ready
related: [XC-039, MON-026, XC-041]
blockers: []
dependencies: ["Muse connector review and business verification", "Stripe: connected account profile management enabled for Lore (only for the SPT route)"]
github_issue: null
created: 2026-10-04
updated: 2026-10-04
---

## Problem

Muse, Meta's personal agent, buys for its users with Stripe Link: a one-time
card per purchase, approved by the user. It reaches apps through connectors
in its own directory. A Lore piece is something a Muse user would want ("find
me someone who has done this before"), but Muse can't find Lore stores, and
can't pay over MCP's x402 path.

## Proposed approach

A Lore connector in the Muse directory, buyer-facing:

- **Read tools** (free): search the marketplace by topic, read a store's
  catalog, read a piece's free page (teaser, sample, who it's for, price).
- **Buy** (a sensitive write, which Muse asks the user to "Allow once"):
  returns seller, full price and currency, and refund terms, as Muse
  requires, then pays. Two ways to pay, cheapest first:
  1. **Checkout handoff.** Return the piece's card checkout (XC-039); Muse
     completes it with its Link one-time card like any other site, and the
     unlocked page returns the text. Needs nothing new from Stripe.
  2. **Shared Payment Token.** Muse issues an SPT for the seller; Lore's
     checkout confirms a PaymentIntent as a direct charge on the seller's
     account (`Stripe-Account` header, `payment_method_data[shared_payment_granted_token]`).
     Stripe supports this for Connect platforms, but each seller needs a
     Stripe profile as the network ID, and creating connected-account
     profiles needs Stripe to enable it for Lore.
- Same price and the same sales ledger as every other path (MON-028).

## Acceptance criteria

- [ ] Muse's connector protocol and auth are confirmed (its docs name OAuth
      and API keys; read-only scope offered where possible).
- [ ] A Muse user can find a piece by topic, read its free page, approve one
      purchase, and read the text, with the sale in the seller's Stripe
      account and Lore's Sales list.
- [ ] Submission packet ready: overview of what the connector does better
      than browsing, business verification, data-processing answers, test
      credentials and account, and each tool marked read or write.

## Notes

Researched 2026-10-04: Muse pays with Link one-time cards and lists
connectors after a three-stage review (risk, tool by tool, end-to-end QA).
Payment writes must show seller, price, currency, terms and refund policy,
and can only be allowed once. Its docs don't name the wire protocol; ask in
the submission. XC-041 (seller terms, takedown) is likely part of business
verification.
