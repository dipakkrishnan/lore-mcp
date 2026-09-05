---
id: APP-083
title: Keep memory ids out of the publish thread
priority: P3
effort: XS
component: desktop-app
status: in-review
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

- [ ] The seeded owner turn names the memory by title and shows no id.
- [ ] The agent's first reply does not echo an id.

## Notes

Screenshot `53-dogfood-draft-candidates.png`.
