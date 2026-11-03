---
id: XC-122
title: Draw the Markets pages as rows, in the site's one look
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-093, XC-114, XC-094]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-02
---

## Problem

XC-093 moved the home page, the bids board and bid pages to one-line rows on hairlines
(docs/design-principles.md §4, §9). `/marketplace` still groups pieces into per-market columns
with a seller picker, a "Latest" strip and a stores list, so Markets and Bids look like two sites.

## Proposed approach

One list of rows (question · market · seller · price), the markets as text tabs as on `/bids`,
search kept. Each market's own page is the same list, narrowed. Drop the card grid styles from
`src/layout.js` once nothing draws them.

## Acceptance criteria

- [ ] `/marketplace` and `/marketplace/:id` are rows with text-tab filters, no cards.
- [ ] 390px wide with no horizontal scroll; dark and light both checked.

## Notes

The audit's step 4 (lists to rows). Kept out of XC-093 to keep that PR to the front door.
