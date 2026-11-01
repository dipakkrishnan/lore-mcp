---
id: XC-118
title: Let sellers sell under a handle without their name leaking
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-115, MON-046, XC-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

Some sellers want to stay anonymous. Store pages, store addresses and the card checkout can
show a seller's real name today. With direct charges, the connected account's business name
appears on the Stripe Checkout page and on the buyer's card statement.

## Proposed approach

Each store has a public handle, and the handle carries the track record ("12 bids filled ·
$140 earned"). Close every place the real name can leak:

- **Card checkout.** Set the connected account's display name and statement descriptor to the
  handle. Check first that Stripe allows this for individual accounts.
- **USDC.** Use one payout address per store and say so in the docs, because an address links
  all of a seller's sales together.
- **Stores and the registry.** Store addresses (`handle.yourlore.dev`) and lore-marketplace
  entries use the handle. Listing PRs come from Lore's account, never the seller's GitHub.
- **Receipts and bid pages.** These show the handle only (MON-046 already keeps account ids
  out).

## Acceptance criteria

- [ ] A test seller with a handle completes a card sale, and their real name appears nowhere on the store, the piece page, Checkout, the bid page or the receipt.
- [ ] Whether Stripe lets the statement descriptor be a handle is recorded, and if it doesn't, the seller is told what the buyer's statement will show.
