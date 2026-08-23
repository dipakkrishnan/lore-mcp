---
id: APP-027
title: Let the owner start a task over instead of resuming forever
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-020, APP-021, APP-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

A resumable task always continues its session file, so a conversation
poisoned by history can never be escaped: Dipak's 2026-08-23 setup session
carried the stale skill text plus three rounds of "the desktop policy
blocks this," and the model concluded the profile write was impossible —
even after APP-021 fixed the gate. There is no owner affordance to say
"start this over."

## Proposed approach

A quiet "Start over" action in the task detail header (and on a Stopped
card): disposes the live session, appends a final done/abandoned record to
the old file so it stops resuming, and starts a fresh session on the next
message. Durable outcomes (blueprint, profile, memories) are untouched —
only the conversation restarts.

For owner-only dogfood, also remove the temporary Bash classifier and
approval UI and give Pi its normal read, write, edit, and Bash tools. Keep a
single typed `finish_task` tool for task lifecycle. APP-008 owns restoring an
OS sandbox before broader use.

## Acceptance criteria

- [x] Start over appears in the task detail and on Stopped cards.
- [x] It ends the old session's record, keeps the file on disk, and the
      next message starts fresh with the current bundled skill.
- [x] No durable artifact (blueprint, profile, library) is affected.
- [x] The agent has normal read, write, edit, and Bash tools; the temporary
      regex classifier and command-approval UI are gone.
- [x] A typed completion signal, not command parsing, closes successful tasks.

## Notes

This deliberately trades the temporary string-matching boundary for a clean
owner dogfood experience. Do not widen distribution before APP-008 is done.
Verified with the desktop typecheck and 10 desktop tests, including a fresh
session after restart while a durable file remains unchanged.
