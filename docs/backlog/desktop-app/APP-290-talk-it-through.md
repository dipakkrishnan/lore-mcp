---
id: APP-290
title: Talk it through, one click from Inventory, the Inbox and the check-in
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-289, AUT-008, APP-218]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-05
updated: 2026-11-05
---

## Problem

Talking is the easiest way to get what someone knows into Lore. Few people type up a lesson, but most will talk
about one for two minutes. Lore already transcribes speech on the Mac, but the mic is a small icon inside the chat
box, and the chat sits behind New → Memory. Nobody finds it unless they go looking (owner, Nov 4: "people have to
know about this to use it").

## Proposed approach

- **Talk it through** (mic icon) in the header of Inbox and Inventory, the two lists where memories show up. One click
  opens a new memory's thread with the mic already on, prompting "Tell Lore what you figured out".
- **The check-in's Inbox row** says **Talk it through** and opens the evening thread listening, so the daily questions
  build the habit.
- **The talk-through loop:** Enter (or the stop button) sends what was said straight to Lore. When Lore answers with a
  question, it listens again. It stops when Lore puts up a memory card to approve, when the owner types, presses Esc,
  leaves the thread, or says nothing. It never listens while Lore is working or before Lore has answered.
- Everything stays on the Mac: the bundled whisper.cpp transcribes, as the mic button already did.

## Acceptance criteria

- [ ] Inbox and Inventory headers show Talk it through, and no other page does.
- [ ] One click opens a new memory's thread already listening, saying what to talk about and how to finish.
- [ ] Enter sends what was said as the owner's words. Lore's next question turns the mic back on.
- [ ] Esc stops without sending. Typing, a card, leaving or silence each end talking it through.
- [ ] The check-in row reads "Talk it through" and opens the evening thread listening.
- [ ] A walk drives it end to end with a fake microphone (the today walk).
