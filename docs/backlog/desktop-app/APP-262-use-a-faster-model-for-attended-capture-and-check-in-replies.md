---
id: APP-262
title: Use a faster model for attended capture and check-in replies
priority: P2
effort: XS
component: desktop-app
status: ideation
related: [APP-259]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

`MODELS` (agent.mjs:107) puts Opus first for every task, including quick captures the owner sits and waits on. Users say the app feels slow.

## Proposed approach

Choose the model per task. Sonnet first for `capture` and `evening`; Opus kept for `publish`, `setup`, `deploy` and `synthesize`. Fall back to whatever the owner is signed in with, as today.

## Acceptance criteria

- [ ] A capture turn's time to first token and total time measured before and after
- [ ] Capture quality spot-checked on 5 sample inputs
- [ ] Agent tests green

## Notes

Dipak decides on quality versus speed.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
