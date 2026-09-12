---
id: APP-079
title: Say "Not set" once in the price labels
priority: P2
effort: XS
component: desktop-app
status: completed
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

- [x] With no store, Settings → Prices shows "Not set" and nothing else.
- [x] With no store, the For Sale header shows "Not set" once, no unit words.
- [x] With a price, both screens are unchanged.

## Notes

Screenshots `28-dogfood-settings.png` and `56-dogfood-for-sale.png` from the
2026-09-05 dogfood pass.

Done 2026-09-05. One `offers()` helper now lists what buyers are charged
(publication only when priced, answers only when enabled); Today's strip and
the For Sale header read from it, and For Sale and Settings fall back to a
single "Not set". Verified on the dogfood sandbox: For Sale shows "Not set",
Settings → Prices shows "Not set", Today's strip is unchanged. PR #210
(APP-019) rewrites the same For Sale lines into `priceRow`/`priceEditor`
and must carry the same fallback when it rebases.
