---
id: APP-007
title: Show durable owner-job status on Today
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-003, APP-004, APP-005]
blockers: [APP-003]
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-08-22
---

## Problem

Capture, synthesis, and deployment activity disappears when its live agent
event ends. Owners need a small durable record of what ran, whether it
succeeded, and what it cost, without storing transcripts, prompts, or
credentials.

## Proposed approach

Add one owner-jobs table to Lore's existing SQLite database and expose its
summary in the desktop snapshot. Record only real app-initiated runs and
scheduled synthesis runs that have a supported completion seam; keep Windup or
the operating system as the scheduler. Today renders the recent rows and the
current live event without creating a second scheduler or analytics store.

## Acceptance criteria

- [ ] The existing Lore SQLite database records job kind, status, summary or
      bounded error, nullable `cost_usd`, and start/finish timestamps.
- [ ] Capture, attended synthesis, and deployment runs initiated by the app
      create and finish one job row; interrupted runs become visibly
      incomplete rather than silently successful.
- [ ] Scheduled synthesis runs are recorded only through a supported execution
      hook; if none exists, the implementation narrows scope instead of
      inferring completion from a schedule.
- [ ] The versioned desktop snapshot exposes recent job summaries and Today
      renders clear running, succeeded, failed, and empty states across app
      restarts.
- [ ] Job rows contain no prompt or memory body, transcript, credential, token,
      private key, or shell command.

## Notes

This is local owner-operation history, not the deployed buyer `answer_jobs`
table and not Pi transcript checkpointing.
