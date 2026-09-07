---
id: APP-070
title: Let the owner type while Lore works
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-069, APP-054]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

While a turn streams, the composer is disabled and any send throws "Lore is
already working" (`agent.mjs:356`). A long setup or deploy turn leaves the
owner unable to correct, add or redirect for minutes, which reads as the app
being stuck (dogfood 2026-09-04, note 6).

## Proposed approach

Pi's `AgentSession` already queues a prompt sent during streaming through
`steer()` (delivered after the current tool call) or `followUp()` (after
the turn), chosen by the session's streaming-behavior option. Use steer:
stop refusing while busy, keep the composer enabled during a turn, and render
the queued message in the thread when Pi delivers it. Decide what a send does
while a card is pending (queue it, or keep the card as the only input) and
make the composer say which.

## Acceptance criteria

- [ ] A message typed mid-turn is delivered after the current tool call and
      appears in the thread in order.
- [ ] No "Lore is already working" error reaches the owner.
- [ ] The existing single-turn invariants (one active task, one card) hold.

## Notes

Post-launch unless dogfooding shows owners repeatedly trying to type during
turns. Pi: `@earendil-works/pi-coding-agent` 0.84.4 `agent-session.d.ts:380`.
