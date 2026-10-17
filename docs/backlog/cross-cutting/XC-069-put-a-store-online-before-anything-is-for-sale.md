---
id: XC-069
title: Put a store online to receive agent saves before anything is for sale
priority: P0
effort: M
component: cross-cutting
status: ready
related: [XC-067, APP-207, APP-215]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-17
---

## Problem

An owner's agent can only save to Lore once their store is online, and
putting a store online today requires a price above zero, an approved piece
and a payout address. A new owner who only wants Grok Bot to save memories
can't get a connect link without first deciding how to sell.

## Proposed approach

Allow a store to go online with nothing for sale: the Cloudflare sign-in and
deploy only, with the agent inbox working and the buyer side answering that
nothing is for sale yet. Price, payout and the first piece come later, when
the owner first approves something to sell, through the existing store flow.

## Acceptance criteria

- [ ] A store with no price, payout or pieces deploys and accepts agent saves.
- [ ] Buyers calling it see nothing for sale, with no errors.
- [ ] The first approved piece walks the owner through price and payout as today.
- [ ] Node and edge tests cover the empty store.
