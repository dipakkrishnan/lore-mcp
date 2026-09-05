---
id: APP-079
title: Say "Not set" once in the price labels
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

With no price set, Settings shows "Not set publication" and the For Sale
header shows "Not set a publication · Off an answer". The formatter returns
"Not set" for a missing price and the callers append the unit word
regardless (`renderer.js:538` and `:660`), so a fresh owner reads a garbled
label on two screens before they open a store (dogfood 2026-09-05).

## Proposed approach

Render the price row as a single "Not set" when the publication price is
absent, and skip the answer half when answers are off, in both the For Sale
header and the Settings row.

## Acceptance criteria

- [ ] With no store, Settings → Prices shows "Not set" and nothing else.
- [ ] With no store, the For Sale header shows "Not set" once, no unit words.
- [ ] With a price, both screens are unchanged.

## Notes

Screenshots `28-dogfood-settings.png` and `56-dogfood-for-sale.png` from the
2026-09-05 dogfood pass.
