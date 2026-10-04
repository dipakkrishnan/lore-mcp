---
id: MON-028
title: Charge one price for a piece however the buyer pays
priority: P1
effort: M
component: monetization
status: completed
related: [MON-009, MON-026, APP-019, XC-039, XC-040]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-10-04
---

## Problem

The store page advertises every piece at $0.01 over x402. Card checkout can't
charge under $0.50, and Stripe's fees make anything under about $1 mostly
fees. Once card checkout ships, the same piece will show two prices: a cent
through MCP and dollars by card. A card buyer who sees both feels overcharged,
and the page reads as confused. The x402 price is a single `PRICE_USD`
constant (`lore/node/src/price.ts`) with no notion of payment rail.

## Proposed approach

Decide the rule before card checkout ships. The candidates:

(a) One price per piece on every rail. This raises the x402 price.

(b) x402 keeps per-piece micro-prices, and cards sell only packs or the
    whole store, so the two never quote the same thing.

(c) A store-wide card price is the only price shown on the page, and x402
    is documented for agents only.

Then make the store page, the JSON-LD `Offer` and `discover` all quote from
one source of truth.

## Acceptance criteria

- [x] The rule is recorded here and in the monetization README.
- [x] No page, JSON-LD offer or `discover` response quotes two different
      prices for the same thing.

## Notes

Raised 2026-09-29 while scoping Stripe card checkout (XC-039, PR #345).
MON-009 decides per-piece versus global prices; this item decides
consistency across payment rails. They may be settled together.

Decided 2026-10-04: **(a), one price everywhere.** The store's single
`lore price` is what a card buyer, an agent paying over x402, the page, the
JSON-LD offer and `discover` all see. Cards appear only while that price is
at least $0.50, and below that the page says nothing about cards.
`lore cards account` refuses a price under $0.50, and `lore price` refuses to
drop under $0.50 while cards are on. Built with XC-039 slice 1.
