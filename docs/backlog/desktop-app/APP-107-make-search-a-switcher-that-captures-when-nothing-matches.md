---
id: APP-107
title: Make search a switcher that captures when nothing matches
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-011, APP-088, APP-108, APP-109]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-12
updated: 2026-09-12
---

## Problem

The sidebar's "Search memories ⌘K" is a filter over the Memories list. It
narrows what is shown and stops there. When the owner types something Lore
does not have yet, the result is an empty list, and the way to add it is a
different control on a different tab ("+ Add Memory", or the Today composer).
Finding and creating are two decisions with two entry points.

Obsidian's quick switcher (walked 2026-09-11) does both with one gesture: type
a fragment and matching notes rank by fuzzy match; type a title that matches
nothing and the same top row reads "Enter to create". The owner never has to
decide whether the thing exists before reaching for it.

## Proposed approach

Turn ⌘K into a switcher rather than a filter:

- A palette over the current view, not a sidebar field. Typing ranks memories
  by title match first, then content match, with the matched fragment
  emphasised. Enter opens the memory sheet (`APP-096`).
- When nothing matches, the first row becomes "Capture '<typed text>'". Enter
  switches to Today with the composer pre-filled with the typed text and
  focused, so the existing capture path runs unchanged. No new write path.
- A one-line footer names the keys: ↑↓ navigate, ↵ open, esc dismiss.

The sidebar field can stay as the click target that opens the same palette.

## Acceptance criteria

- [x] ⌘K opens a palette from any view; typing ranks memories by title, then content, and Enter opens the selected memory's sheet.
- [x] With no match, the first row offers to capture the typed text; Enter lands on Today with the composer holding that text and focused.
- [x] esc closes the palette and returns focus to where it was.
- [x] The palette footer names the three keys.
- [x] Reduced-motion users get the palette without the fade.

## Notes

Filed 2026-09-12 from an operated comparison of Obsidian 1.13's quick
switcher against the current Lore renderer (`app/desktop/src/renderer.js`,
where ⌘K focuses and selects the search field). The capture row reuses the
Today composer on purpose: capture still goes through `lore capture apply`
via the agent, and the palette adds no second way to write a memory.

Completed 2026-09-12. The sidebar field is now a button that opens the same
palette, and the list filter it used to drive is gone: the palette is the one
place that finds. Two choices beyond the criteria, both from Obsidian's
switcher: with nothing typed the palette lists the eight most recent memories,
and the capture row is always offered once something is typed, last when there
are matches and first when there are none, since a fuzzy match is often not the
thing the owner meant. Ranking is the store's FTS order with title matches
lifted to the top; the typed terms are marked in the title and in a snippet of
content around the first match. When Today's composer is hidden or locked by a
card, the text still lands in it and a notice says to finish what Lore is
asking first. Verified by the seller persona in `support/edge.cjs`.
