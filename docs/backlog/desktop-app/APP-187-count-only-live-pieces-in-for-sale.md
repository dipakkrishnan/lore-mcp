---
id: APP-187
title: Count only live pieces in the For Sale tab
priority: P3
effort: XS
component: desktop-app
status: obsolete
related: [APP-093, APP-091]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-13
---

## Problem

The For Sale count includes approved pieces that aren't in a store yet, so
the sidebar says "For Sale 1" while the store says "No store yet". The seller
thinks something is on sale when nothing is.

## Proposed approach

Count only pieces that are live in the store. List approved pieces that
aren't live yet under a "Not on sale yet" label, and leave them out of the count.

## Acceptance criteria

- [ ] With no store open, the For Sale count is 0 (or hidden)
- [ ] Approved pieces still appear, marked as not on sale yet

## Notes

Filed from the 2026-10-06 new-seller audit.

**Prioritization (2026-11-12):** Priority P3 (was P2). Moved back from ready
to in-review. Before it can be ready: Nothing to build as written; close it.
Prioritization flag (not acted on): obsolete/done: APP-282's Inventory tabs
and the Pending status cover both criteria.

**Close-out (2026-11-13):** obsolete. The For Sale tab and its sidebar count
are gone. APP-282 (bf2e5ee0, #657) merged Memories and For Sale into Inventory,
whose sidebar count is all items (`renderer.js` ~5098). Inventory's last shelf is
labelled by store state: `["sale", forSale(s) ? "On sale" : "Ready to sell"]`
(~2487). Each piece's status follows the same rule: "Pending" while the store is
open but the piece is not live, otherwise "On sale" or "Ready to sell" (~2648).
With no store, nothing reads as on sale. Approved pieces still show, marked
"Ready to sell", and the Inbox's next step says "N approved pieces aren't on
sale yet" (`nextStep`, ~962). The confusion this item describes can no longer
happen.
