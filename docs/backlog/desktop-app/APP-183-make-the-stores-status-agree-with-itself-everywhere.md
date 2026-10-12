---
id: APP-183
title: Make the store's status agree with itself everywhere
priority: P1
effort: S
component: desktop-app
status: ready
related: [APP-136, APP-081, APP-079]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

The app describes the same store in ways that contradict each other:

- "Live · Test mode" next to a store that takes real money.
- Settings says "Test payments… Switch to real payments", but the desktop
  opens stores on real money.
- Settings Price says "Not set" while the store is charging.
- The store bar and Today show "Not set" / "Store not set up" in code font.

## Proposed approach

Work out the store's status (not open, open and selling, paused) and its
price once from the snapshot, and have every screen show those values. Drop
the test-mode wording from the seller UI. Use body text, not mono, for status.

## Acceptance criteria

- [ ] A live real-money store never shows "Test" anywhere
- [ ] Price shows the charged price wherever it appears
- [ ] No status text renders in code font

## Notes

Filed from the 2026-10-06 new-seller audit.
