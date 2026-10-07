---
id: MON-041
title: Explain free copies where the price is set and limit them per reader
priority: P1
effort: S
component: monetization
status: ready
related: [MON-040, APP-136, MON-035]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Free copies (MON-040) are on by default, but the seller never chose them and
nothing explains them. A seller who opens their own piece page sees Read free
and no Buy button, so the store looks broken. There is also no per-reader
limit, so one person or one script can use up every free copy.

## Proposed approach

- Next to the price: "Your first 3 readers per piece read free; Buy appears
  after." with a Change link. Consider defaulting to 1.
- Let the seller preview the page as a buyer sees it once the free copies are gone.
- Limit free copies to one per reader (by buyer identity or IP) on the node.

## Acceptance criteria

- [ ] The price row and the store-opening card both explain free copies
- [ ] The seller can see their page as a paying buyer would
- [ ] One reader cannot claim more than one free copy of a piece

## Notes

Filed from the 2026-10-06 new-seller audit. Without a per-reader limit,
sellers can lose sales once a store link is shared publicly.
