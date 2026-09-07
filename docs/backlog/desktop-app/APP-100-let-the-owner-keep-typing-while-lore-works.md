---
id: APP-100
title: Let the owner keep typing while Lore works
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-069, APP-053, APP-099]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

A running turn locks the composer across Desktop. The owner cannot hand off
another thought, and incoming cards can pull them away from their current
view. Lore should keep working while the owner keeps thinking.

## Proposed approach

**Promise: hand it off, move on, return to a clear result.** Ship after the
private alpha; this is not a release gate. Keep one executing agent turn.

- Keep typing and navigation available. A submitted follow-up appears as
  **Up next**, with **Remove**, until execution starts. No steering mode.
- Accept work in another existing task; show **Starts after [task title]**.
  Run it in submission order after the active turn and its follow-ups finish.
- Reuse Today rows for **Working**, **Needs you**, and **Ready to review**.
  Cards and results stay in their own task; never switch views or steal focus.
- Preserve each task's composer text, attachments, conversation, and pending
  card when navigating. Card corrections still answer that card; they are
  not queued as a new instruction. Free text never substitutes for approval.
- A pending owner card holds the execution slot. Other work remains accepted
  but shows **Waiting for your answer in [task title]** with a link there.
- **Stop** cancels the active turn and its pending card waits. Unstarted
  follow-ups in that task remain recoverable but require explicit resubmission;
  other queued tasks proceed only after cancellation has settled. Stop never
  claims to undo completed actions.
- Preserve drafts and unstarted submissions locally across relaunch. Restore
  them for explicit resumption; never silently execute them. Do not persist
  secret-card values. Report missing attachments without losing the text.

## Acceptance criteria

- [ ] In the packaged app, start store setup, navigate away, and submit a
      capture without waiting. Its text and attachments appear once, as queued.
- [ ] When setup asks for approval, the current view and draft stay put.
      Today identifies the task needing attention; capture names what blocks it.
- [ ] Stop setup while its card is pending. The card is dismissed, the turn
      settles, and capture proceeds. No hung promise, accidental approval,
      duplicate execution, or overlapping sandbox work.
- [ ] Return to capture and find its result/card in the correct conversation.
      Background progress and errors never appear in another task's transcript.
- [ ] Send and remove an active-task follow-up; it never executes. An accepted
      follow-up executes once after the current turn. Failed submission retains
      the owner's text and attachments with a retry path.
- [ ] Navigate and relaunch with drafts and queued work present. Content is
      retained, status is truthful, and relaunch triggers no automatic action.
- [ ] Add focused checks for queue ordering/removal, cancellation while waiting
      on a card, and task-local event routing; prove the journey above in the
      packaged app with isolated dogfood data. Keyboard use and status labels
      remain accessible without relying on color.

## Notes

Implementation starting points, not a new framework:

- `app/desktop/src/agent.mjs`: retain serialized execution. Reuse Pi follow-up
  support and one small main-process queue for other tasks. Shared sandbox
  policy, active-task identity, and turn accounting must remain isolated by
  serialization; unlocking the renderer alone is insufficient.
- `main.cjs`, `preload.cjs`, `types.d.ts`: expose queued state and cancellation.
  Propagate abort through every attended tool/request; `session.abort()` alone
  does not release owner-card promises today. Acknowledge submissions only
  after retaining them; keep one authoritative pending-work record.
- `renderer.js`, `styles.css`: replace global composer blocking and automatic
  card navigation with task-local drafts, status, and controls. Preserve the
  existing memory-correction and explicit approval flows.

Out of scope: concurrent agent execution, running another task while a card
waits, arbitrary new conversations, scheduling, queue reordering, a new task
screen, automatic retries, and automatic execution after relaunch. Do not
broaden sandbox permissions to make concurrency appear to work.
