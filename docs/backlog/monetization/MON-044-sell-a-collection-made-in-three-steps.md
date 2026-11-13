---
id: MON-044
title: Sell a collection made in three steps
priority: P3
effort: L
component: monetization
status: in-review
related: [MON-040, XC-039, XC-036]
blockers: []
dependencies: []
github_issue: 421
created: 2026-10-09
updated: 2026-11-13
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

**Backlog audit (2026-11-12), moved to in-review:** The first four criteria
shipped in PR #425: the three-step creation, `collection_<id>` with discover
listing, the /p/<id> page with card checkout, and marketplace display
(site/src/markets.js). The last criterion, "a real buyer purchases a
collection," is a market event. It cannot happen until an owner puts a
collection on sale, and no live store has one today. A human should either
list a collection and wait for a sale, or move that criterion to a launch-
validation item and close this one.

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Move "a real buyer purchases a collection" to a
launch-validation item, then close. Prioritization flag (not acted on): done
except the market-event criterion.

**Close-out (2026-11-13):** Stays in-review. The four code criteria hold on
this branch (PR #425, merged 2026-10-22): `toolName()` gives
`collection_<id>` in `lore/node/src/collections.ts`, and collections are
listed in `site/src/markets.js`. What remains is the one market-event
criterion, "a real buyer purchases a collection". It cannot be built: an owner
has to put a collection on sale and a buyer has to buy it. No launch-validation
item exists to move it to (a search of `docs/backlog/` found none). Either the
owner lists a collection and waits for a sale, or a launch-validation item is
filed for this and similar market-event checks (MON-047's live card sale,
MON-025's 1¢ purchase) and this item closes.
