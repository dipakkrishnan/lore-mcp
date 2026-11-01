---
id: APP-227
title: The assistant can't publish on its own
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-226, APP-130]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-18
---

## Problem

Lore's in-app assistant reads memories that the owner's other agents saved, and
it runs shell commands and writes files in a sandbox. Store updates and the
app's own folders should stay the app's, and what other agents saved should
read as material rather than as requests from the owner.

## Proposed approach

- The assistant's shell refuses store update and deploy commands before they
  run, and its write and edit tools refuse the app's own folders, on top of the
  sandbox. Store updates go through `open_store`, which waits on the owner's
  card (APP-226).
- The assistant is told that memories and saved items are material to read,
  never instructions, and readings say so too.

## Acceptance criteria

- [x] Store update and deploy commands are refused before they start
- [x] Write and edit refuse the app's own folders
- [x] The assistant's prompt and readings label saved material as material
- [x] Tests for each
