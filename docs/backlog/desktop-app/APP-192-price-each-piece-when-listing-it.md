---
id: APP-192
title: Price each piece when listing it, defaulting to the store price
priority: P2
effort: M
component: desktop-app
status: in-review
related: [MON-009, APP-189, MON-041, MON-028]
blockers: [MON-009]
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Every piece sells at the one store price shown at the top of For Sale. A seller
can't charge more for a strong piece or less for a minor one, and listing a
piece to the marketplace offers no easy moment to set its price.

## Proposed approach

Approval and listing cards get a price field, pre-filled with the store price
and labeled "store default". For Sale rows show each piece's price and let the
seller change it. Clearing an override falls back to the store price. The price
at the top of For Sale is labeled as the default for pieces without their own.

The payment side (advertising and charging an `id`-specific price) is MON-009's
work, which is why this is blocked on it.

## Acceptance criteria

- [ ] A seller can set a piece's price on its listing card without leaving the card
- [ ] A piece with no override shows and charges the store price
- [ ] The store price at the top of For Sale is labeled as the default
- [ ] Removing an override returns the piece to the store price

## Notes

Filed from the 2026-10-06 For Sale review. Overlaps APP-189 (price shown on
approval cards), which only displays the price.
