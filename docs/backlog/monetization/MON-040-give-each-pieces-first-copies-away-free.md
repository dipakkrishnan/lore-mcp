---
id: MON-040
title: Give each piece's first copies away free
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-038, MON-039, XC-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-05
updated: 2026-10-05
---

## Problem

A first buyer needs a card (only at $0.50 or more) or a funded USDC wallet
and an agent set up to pay. Both are too heavy for someone curious about one
piece, so a new store has no readers and its seller sees nothing happen.

## Proposed approach

Each piece gives its first few copies away free (store-wide, default 3, 0
turns it off). The page leads with "Read free" and how many free copies are
left; `get` returns the piece unpaid while copies remain. Every free copy is
a $0 row in the sales ledger, which is also the counter: one conditional
INSERT, so readers claiming at once can't take more than the limit. The
seller's app lists it and notifies "Someone read a free copy". Page readers
keep their copy under a link of its own, like a card receipt. No identity:
one person can take several copies.

## Acceptance criteria

- [x] `lore free-copies N` sets the count (owner action), baked in at deploy.
- [x] The page offers a free copy while any are left, then the normal Buy box.
- [x] Unpaid `get` returns a free copy while any are left; a paid call is unchanged.
- [x] Concurrent claims never exceed the limit.
- [x] Free copies are $0 ledger rows: never earnings, never refund owed.
- [x] The desktop notifies for a free copy in its own words.
