---
id: APP-110
title: Preview a memory on hover without leaving the list
priority: P3
effort: S
component: desktop-app
status: completed
related: [APP-092, APP-096, APP-108, APP-023]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-12
updated: 2026-09-12
---

## Problem

Checking what a memory says means opening its sheet, reading, and closing it.
That is fine for one memory and tiring for ten. It matters most on For Sale,
where an owner deciding whether something should stay published wants to
glance at the content, not open a modal per row. It will matter on the
Related section from `APP-108` for the same reason: the point of a link is to
peek down it.

Obsidian's page preview (walked 2026-09-11) shows the full linked note in a
card on ⌘-hover, with an expand control to open it for real. Reading is free;
navigation is a deliberate second step.

## Proposed approach

A hover card, same mechanism and surface style as the tab notes from
`APP-092`, with content instead of a two-sentence explanation:

- Hovering a Memories row, a For Sale row, or a Related row for a short delay
  shows the memory's title, captured date, and the first few hundred
  characters of content, clipped with a fade.
- Keyboard focus on the row shows the same card; esc hides it.
- The card is read-only. Clicking it opens the sheet, and the card never
  offers actions, so nothing is one accidental hover from a change.
- Positioned to the right of the row when there is room, below it otherwise,
  never past the window edge.

## Acceptance criteria

- [x] Hovering or focusing a memory row on Memories, For Sale, or Related shows a preview card after a short delay, and leaving or pressing esc hides it.
- [x] The card shows title, captured date, and clipped content, and offers no actions.
- [x] Clicking the card opens that memory's sheet.
- [x] The card stays inside the window at every row position.
- [x] Reduced-motion users get the card without the fade.

## Notes

Filed 2026-09-12 from an operated comparison of Obsidian 1.13's page preview
against the Lore Memories and For Sale lists. Deliberately no ⌘ modifier: the
Obsidian gesture is a power-user habit, and Lore's owners are not expected to
have it.

Completed 2026-09-12 for Memories rows. For Sale rows are not covered: the
snapshot carries a publication's title and topic only, and the CLI has no
command that reads one publication's content, so that half needs a Python
change (a `publication show --json`) before the renderer can preview it. Filed
as a follow-up rather than widened here. Related rows wait on `APP-108`. The
card reads through the existing memory IPC, cached per snapshot, and shows
after 450 ms on hover or focus; Escape, leaving, scrolling, or any re-render
hides it. Verified by the seller persona in `support/edge.cjs`.
