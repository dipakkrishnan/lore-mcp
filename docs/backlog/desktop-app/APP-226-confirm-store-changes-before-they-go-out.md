---
id: APP-226
title: Confirm store changes before they go out
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-227, APP-130, XC-069]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-18
---

## Problem

Owners' personal agents now save into their Lore, and Lore's own assistant
drafts pieces from those memories and can open or redeploy the store. A store
update could put pieces on sale, change the price, or change where payments go,
and the owner only saw a one-line summary (or nothing, for a push after an
approval).

## Proposed approach

Before any store update that adds or changes pieces for sale, or changes the
price, the payout address, the network or the store's address, the app shows one
card listing each change: pieces going on sale, pieces updated, pieces coming
off, and each term from old to new. Nothing goes out without Confirm. An update
that only takes pieces down, or changes nothing, goes ahead without a card.

The CLI leaves the push after an approval or a take-down to the app when the app
asks it to, so every update goes through the card.

## Acceptance criteria

- [x] Opening, redeploying and pushing the store list each change and wait on Confirm
- [x] Cancel, or closing the card, puts nothing out
- [x] Taking pieces down alone, or an update with no changes, needs no card
- [x] Unit tests for the change list and the gate; an edge walk check of the card

## Notes

The card is a sheet, so it works from any tab, including from the assistant's
thread.
