---
id: APP-183
title: Make the store's status agree with itself everywhere
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-136, APP-081, APP-079]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-11
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

- [x] A live real-money store never shows "Test" anywhere
- [x] Price shows the charged price wherever it appears
- [x] No status text renders in code font

## Notes

Filed from the 2026-10-06 new-seller audit.

- APP-281 and APP-283 already fixed "Live · Test mode", the store bar, Today and the mono status text. This item
  works out the status in one place and closes the "Not set" price gap.
- `storeStatus(s)` in `app/desktop/src/renderer.js` returns `{label, tone, test}`. The Address pill, the workspace
  menu, the Settings Test payments row and the buyer preview all read it. `nodeLabel` is now a thin wrapper over it.
  `test` means the test network only, so a real-money store or an unknown network is never "Test". The Address row's
  "Open your store" button and `forSale()` still check `selling === false` directly.
- Price rule: there is one owner-first price everywhere, `storePrice(s)`. It is the saved price, or the store's live
  price when nothing is saved, or null when neither is known. Settings, the price sheet's pre-fill, the FAQ, every
  Inventory row, a memory's side panel, the store-opened line, the card minimum and the preview all read it. A
  saved price not yet on the store is explained only by the existing notes in the Address row (`storeUpdate`) and the
  Inbox (`nextStep`). Nothing new was added to the Price row, so the old price is stated once.
- With nothing saved and the store unreachable, the price is null, and "Not set" is the honest answer.
- Tests: `app/desktop/test/unit/renderer-store-status.test.cjs`. Its font check reads `styles.css` for five
  selectors only (`.mono`, `.pill`, `.chip`, `.value`, `.run-state`) to limit brittleness.
- Design review found Inventory's date wrapping onto two lines. That was already true on main, so it is filed as
  APP-293.
