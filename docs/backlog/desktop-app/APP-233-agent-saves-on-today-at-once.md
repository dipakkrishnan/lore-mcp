---
id: APP-233
title: Put an agent's saves on Today as they come in, and credit what an interrupted reading wrote
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-207, APP-213, AUT-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-21
updated: 2026-10-21
---

## Problem

When Grok Bot, Claude or ChatGPT saves to Lore, nothing shows on Today until a full model reading of those saves calls `memories_ready`. That reading waits behind other quiet work, and it starts over each time the owner does anything in the app. The saves are already finished memories, written by the agent, so the owner waits on a model for no reason.

A reading that gives way to the owner also loses what it wrote. On Oct 21 a reading wrote `travel-….md` and edited INDEX.md, then gave way before it reported back. The re-run found the file already there and reported `{"read": 4, "memories": []}`, so Today showed nothing, although the memory existed. This can happen to any reading, not only an agent's.

## Proposed approach

- `lore sources read` names the memories an agent's read added or changed (`memories: [{id, title}]`). The app puts them on Today at once, credited to the agent, and sends the notification that opens them in Inventory.
- The reading still runs afterwards. Whatever it writes joins that agent's card (`Ready.extend`). It does not put up a second card or send a second notification.
- A reading's result is every file in the memories folder that its runs changed, judged by modified time around each run, together with what the model reported. A run that gave way keeps its changes for the run that finishes. A run that ends without reporting still hands back what it wrote. Files changed during the owner's own turns are never counted.

## Acceptance criteria

- [x] An agent's saves are on Today, credited to the agent, as soon as the read brings them in, with no model turn.
- [x] A reading of the same agent's saves adds its memories to that card. It does not put up a second card. The card counts as unseen again only if it gained a memory.
- [x] A reading that wrote a memory, gave way to the owner, and was re-run hands that memory back, even though the re-run reported none.
- [x] Nothing written during the owner's own turn is credited to the reading.

## Notes

How often Lore asks the store is APP-232's job (PR #523: 10s on screen, 3s while an app waits to sign in), so this item leaves the pace alone.
