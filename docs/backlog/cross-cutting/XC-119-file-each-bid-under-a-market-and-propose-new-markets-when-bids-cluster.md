---
id: XC-119
title: File each bid under a market, and propose new markets when bids cluster
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-074, MON-051, XC-114]
blockers: []
dependencies: [MON-051]
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

Bids arrive as free-text questions, often outside the markets that exist today. Without a
market, a bid can't appear in a market column on the board, a market bid count, or a seller's
matches. Bids that keep landing outside every market are also the clearest signal of which
market to open next.

## Proposed approach

- When a bid arrives with no market, a model classifies it into one of the registry's
  `markets`, or into "Unsorted" if none fits. The bidder can change the market.
- A weekly job groups Unsorted bids. Any cluster of three or more becomes a proposed market
  (name, one-line description, the bids behind it) that the owner approves in lore-marketplace
  with one PR. Lore never opens a market on its own.

## Acceptance criteria

- [ ] Every bid has a market or "Unsorted" within a minute of being placed.
- [ ] Three similar Unsorted bids produce one proposed-market PR naming the bids behind it.
