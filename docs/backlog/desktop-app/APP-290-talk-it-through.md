---
id: APP-290
title: Talk it through, one click from Inventory, the Inbox and the check-in
priority: P3
effort: M
component: desktop-app
status: in-review
related: [APP-289, AUT-008, APP-218]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-05
updated: 2026-11-12
---

## Problem

Talking is the easiest way to get what someone knows into Lore. Few people type up a lesson, but most will talk
about one for two minutes. Lore already transcribes speech on the Mac, but the mic is a small icon inside the chat
box, and the chat sits behind New → Memory. Nobody finds it unless they go looking (owner, Nov 4: "people have to
know about this to use it").

## Proposed approach

- **Record a memory** (mic icon) in the header of Inbox and Inventory, the two lists where memories show up. One click
  opens a new memory's thread with the mic already on, prompting "Tell Lore what you figured out".
- **The check-in's Inbox row** says **Answer** and opens the evening thread listening, so the daily questions
  build the habit.
- **The first turn:** Enter (or the stop button) sends what was said straight to Lore. Only that first turn listens on
  its own; after Lore answers, the owner picks the mic or the keyboard (dogfood, Nov 5: re-listening after every answer
  caught side remarks like "Whoa." as turns). Typing, Esc, leaving the thread or saying nothing ends it sooner.
- Named in dogfood, Nov 5: "Talk it through" didn't say what to talk about, so the header says **Record a memory**
  and the check-in row **Answer**.
- Everything stays on the Mac: the bundled whisper.cpp transcribes, as the mic button already did.

## Acceptance criteria

- [ ] Inbox and Inventory headers show Record a memory, and no other page does.
- [ ] One click opens a new memory's thread already listening, saying what to talk about and how to finish.
- [ ] Enter sends what was said as the owner's words. Lore's next question turns the mic back on.
- [ ] Esc stops without sending. Typing, a card, leaving or silence each end talking it through.
- [ ] The check-in row reads "Answer" and opens the evening thread listening.
- [ ] A walk drives it end to end with a fake microphone (the today walk).

## Notes

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Close as completed. Prioritization flag (not acted
on): done: #666.
