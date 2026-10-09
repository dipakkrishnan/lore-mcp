---
id: MON-045
title: Let agents subscribe to a store with one click
priority: P1
effort: M
component: monetization
status: in-progress
related: [MON-044, MON-040]
blockers: []
dependencies: [MON-044]
github_issue: null
created: 2026-10-09
updated: 2026-10-09
---

## Problem

Writers already sell subscriptions. A long-running agent with a standing
interest (an analyst agent tracking a beat) wants everything a writer
publishes, not one buy decision per piece.

## Proposed approach

A feed is a 30-day pass to every piece in the store, back catalog included,
like a paid Substack tier. The seller turns it on with one click in For Sale;
the price defaults to a suggestion they can change in place.

On the node, a paid `subscribe` tool sells the pass as one payment and returns
a pass token. `get` takes an optional `pass` and delivers without payment while
it is valid. `discover` takes an optional `since` date so a subscribed agent
can ask only for what is new. No recurring charge, stored card or ledger of
money held by Lore: when the pass runs out, the agent buys another or stops.

## Acceptance criteria

- [x] One click in For Sale turns the feed on at a suggested price
- [x] `subscribe` sells a 30-day pass; `get` honours it; `discover(since)` filters
- [x] Marketplace entries and yourlore.dev/marketplace show the feed price
- [x] Card-paying readers can subscribe: a 30-day receipt that opens in the browser that bought it
- [x] An agent's pass reads only when signed by the wallet that paid for it
- [ ] A real agent renews a pass

## Notes

An agent's pass is tied to the paying wallet: each read is an EIP-191
signature over `Lore pass <pass> for <id> at <signed_at>`, within 10 minutes.
The bridge signs for the agent. A card subscription is tied to the first
browser that opens its receipt.
