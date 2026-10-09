---
id: MON-044
title: Sell a collection made in three steps
priority: P1
effort: L
component: monetization
status: in-progress
related: [MON-045, MON-040, XC-039, XC-036]
blockers: []
dependencies: []
github_issue: 421
created: 2026-10-09
updated: 2026-10-09
---

## Problem

A buyer researching a topic wants all of one writer's thinking on it, not a
dozen separate buy decisions. Today a store sells one piece per payment, and
the only way to put something on sale is the draft-and-approve flow.

## Proposed approach

A collection is a named set of pieces with one price. The seller makes one in
three steps:

1. **New → Collection.** It exists at once, titled "Untitled collection".
2. **Dump context into it.** Drop files or paste text. Each becomes a piece
   (kind `content`), backed by a private memory, titled by its filename or
   first line.
3. **Price it.** Setting a price puts it on sale and pushes the store.

On the node, each collection is a paid MCP tool `collection_<id>` at its own
price (x402 tools are fixed-price), returning every piece in one call.
`discover` lists collections with their pieces, price and the sum of single
prices. A collection's id has the same shape as a piece id, so its page is
`/p/<id>`, its listing `/p/<id>.json`, and card checkout works unchanged; the
card receipt keeps the whole collection as one copy.

The pieces stay for sale on their own too. The sales ledger records a
collection sale as `kind = 'publication'` with the collection id, since the
deployed `sales` table's CHECK can't take a new kind without a rebuild.

## Acceptance criteria

- [x] New → Collection, drop or paste, set a price: three actions to on sale
- [x] `discover` lists collections; `collection_<id>` buys all pieces at once
- [x] A collection page and card checkout through the existing checkout
- [x] Marketplace entries and yourlore.dev/marketplace show collections
- [ ] A real buyer purchases a collection

## Notes

Supersedes the scope in issue #421. Out of scope: cross-seller bundles,
ordering pieces by hand, updates after purchase (a buyer gets the collection
as it stood).
