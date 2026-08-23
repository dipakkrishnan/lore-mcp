---
id: APP-027
title: Let the owner start a task over instead of resuming forever
priority: P1
effort: S
component: desktop-app
status: in-review
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

## Acceptance criteria

- [ ] Start over appears in the task detail and on Stopped cards.
- [ ] It ends the old session's record, keeps the file on disk, and the
      next message starts fresh with the current bundled skill.
- [ ] No durable artifact (blueprint, profile, library) is affected.
