---
id: APP-246
title: Let automations suggest collections for the owner to review
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-200, MON-044]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-25
updated: 2026-10-25
---

## Problem

An owner can tell an automation to "gather what I learned this week", but it
can't put the result in a collection. Changing a collection puts pieces on
sale, so `lore collection` is owner-only and refuses unattended runs. An
automation therefore has no way to start a collection or add to one, and
the owner has to rebuild the same set by hand each time.

## Proposed approach

An automation never changes a collection. It suggests one instead. When an
owner's routine asks for a collection, the agent hands back `collection` in
`memories_ready`. That field holds the collection's name (an existing
collection's exact name means add to it) and the memories it should hold,
by id or by memory file. Lore keeps each suggestion in
`collection-suggestions.json` under the app's user data, sends a banner, and
shows "Suggested collections" on Today with Review and Dismiss. Review opens
the existing picker with the memories ticked. For a new collection that is
the three-step wizard with the name filled in. For an existing collection it
is that collection with "Add memories" open. Nothing goes in, or on sale,
until the owner confirms.

## Acceptance criteria

- [ ] A routine whose instructions ask for a collection can hand one back, and Lore suggests it with a banner
- [ ] Today shows the suggestion: its name, how many memories and which automation, with Review and Dismiss
- [ ] Review on a new name opens the wizard named for it with its memories ticked; on an existing collection's name it opens that collection's picker with them ticked
- [ ] A newer suggestion for the same name replaces the older one, and memories since deleted are left out
- [ ] Nothing reaches a collection or the store without the owner confirming in the picker and price step
