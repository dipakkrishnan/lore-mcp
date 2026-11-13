---
id: APP-246
title: Let automations suggest collections for the owner to review
priority: P3
effort: M
component: desktop-app
status: completed
related: [APP-200, MON-044]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-25
updated: 2026-11-13
---

## Problem

An owner can tell an automation to "gather what I learned this week", but it
can't put the result in a collection. Changing a collection puts pieces on
sale, so `lore collection` is owner-only and refuses unattended runs. An
automation therefore has no way to start a collection or add to one, and
the owner has to rebuild the same set by hand each time.

## Proposed approach

An automation never changes a collection. It suggests one instead. When an
owner's routine asks for a collection, the agent hands back `collections` (up to three) in
`memories_ready`. Each holds the collection's name (an existing
collection's exact name means add to it) and the memories it should hold,
by id or by memory file. Lore keeps each suggestion in
`collection-suggestions.json` under the app's user data, sends a banner, and
shows "Suggested collections" on Today with Review and Dismiss. Review opens
the existing picker with the memories ticked. For a new collection that is
the three-step wizard with the name filled in. For an existing collection it
is that collection with "Add memories" open. Nothing goes in, or on sale,
until the owner confirms.

Lore runs one of these itself. "Suggest collections" is a built-in routine
next to Read connected apps and Evening check-in. It runs weekly on Sunday
at 10 AM, and the owner can pause or retime it but not remove it. It runs
on a fixed sentence: group kept memories into up to three sets worth more
together, add to an existing collection where one fits, and write no new
memories.

## Acceptance criteria

- [x] A routine whose instructions ask for a collection can hand one back, and Lore suggests it with a banner
- [x] Today (now the Inbox) shows the suggestion: its name, how many memories ~~and which automation~~, with Review and Dismiss. The automation's name was dropped on purpose when #571 gave the row the New memories row's shape. The source is still kept (`from` in `collection-suggestions.json`) and recorded as the routine's last result.
- [x] Review on a new name opens the wizard named for it with its memories ticked; on an existing collection's name it opens that collection's picker with them ticked
- [x] A newer suggestion for the same name replaces the older one, and memories since deleted are left out
- [x] Nothing reaches a collection or the store without the owner confirming in the picker and price step
- [x] "Suggest collections" is one of Lore's own automations: weekly, pausable and retimable, never removable

## Notes

**Prioritization (2026-11-12):** Priority P3 (was P2). Stays in-review.
Before it can be ready: Check the criteria against the Inbox (they say
Today) and close. Prioritization flag (not acted on): done: #564/#571.

**Close-out (2026-11-13):** completed. Shipped in #564 and #571, both merged,
then moved onto the Inbox by APP-283. Evidence on main:
- **Hand-back and banner.** `app/desktop/src/ipc.cjs` ~659-673 reads
  `report.collections`, keeps only memories Lore still holds, stores each with
  `from`, and notifies "Lore suggested a collection you could sell". It records
  "Suggested N…" as the routine's result.
- **Inbox row.** `inbox.js` ~85: "Lore suggests a collection: “name” · N
  memories", with Review and done (dismiss). The row is wired at `renderer.js`
  ~1331.
- **Review.** `reviewSuggestion()` (`renderer.js` ~3167) opens `newCollection`
  for a new name, or the existing collection with `collectionAdding` and the
  picks ticked.
- **Replace by name.** `reading.Suggestions.add` (~201) replaces by name, case
  folded. Deleted memories are filtered at render (~1254) and at intake.
- **Owner confirms.** The edge walk (`support/edge.cjs` ~2244) asserts "Cancel
  leaves the suggestion in the Inbox" and "Continue puts its memories in, then
  clears it".
- **Built-in routine.** `Collect` in `lore/automation.py` ~580 (id `collect`,
  "Suggest collections", weekly at 10 AM Sunday, retimable).
  `Routines.remove` refuses built-ins ("Lore's own routines can be paused, not
  removed").
- **Tests.** `tests/test_automation.py` ~901 and `test/unit/app.test.cjs:441`
  ("APP-246: an automation's collection is a suggestion…").

The one deliberate gap is shown struck in criterion 2.
