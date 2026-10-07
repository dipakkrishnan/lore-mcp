---
id: APP-189
title: Show the price on approval cards and Preview without Edit
priority: P2
effort: XS
component: desktop-app
status: ready
related: [APP-136, APP-134, MON-041]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Approval cards don't say what the piece will sell for, so a seller approves a
piece without seeing its price. The Preview page button only appears after
Edit.

## Proposed approach

Add "Sells for $X" (and the free-copies line) to every approval card, and show
Preview page on the read-only card, not only while editing.

## Acceptance criteria

- [ ] Every approval card shows the price the piece will sell for
- [ ] Preview page is reachable without pressing Edit

## Notes

Filed from the 2026-10-06 new-seller audit.
