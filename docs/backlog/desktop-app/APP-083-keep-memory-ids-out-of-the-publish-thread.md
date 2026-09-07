---
id: APP-083
title: Keep memory ids out of the publish thread
priority: P3
effort: XS
component: desktop-app
status: completed
related: [APP-023]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

"Draft for sale" on a memory seeds the publish thread with an owner turn that
reads: Help me publish something from my Lore. Start from memory 38: "Tank
cleanup crew: …". The agent then echoes "Let me read memory 38". The number
is a database id the owner never sees anywhere else in the app (dogfood
2026-09-05).

## Proposed approach

Seed the visible turn with the title only, and pass the id to the agent in
the hidden task context so the thread reads like something the owner said.

## Acceptance criteria

- [x] The seeded owner turn names the memory by title and shows no id.
- [x] The agent's first reply does not echo an id.

## Notes

Screenshot `53-dogfood-draft-candidates.png`.

Done 2026-09-05. "Draft for sale" now sends the id as a separate `memory`
field on the prompt IPC; the agent appends "Start from the memory with id N."
to the turn it sends to the model, and thread history strips that line, so
the owner's turn reads `Help me publish something from my Lore, starting
from "<title>"` live and after relaunch. The desktop system prompt also
lists memory ids with the plumbing the agent never names in prose.
Verified on the dogfood sandbox with a real publish turn: the agent's first
reply says "Let me read the memory", no id.
