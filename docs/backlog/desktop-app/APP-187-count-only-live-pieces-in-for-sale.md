---
id: APP-187
title: Count only live pieces in the For Sale tab
priority: P2
effort: XS
component: desktop-app
status: ready
related: [APP-093, APP-091]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
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
