---
id: APP-099
title: Show owner cards one at a time, never racing
priority: P0
effort: XS
component: desktop-app
status: in-review
related: [APP-057, APP-056, APP-052]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

On "Switch to real payments" the agent asked for both Coinbase values in one
turn: two `store_secret` calls in a single assistant message. Pi runs tool
calls in parallel by default, so both cards reached the renderer at once. The
renderer holds one card, so the second replaced the first; when the owner
dismissed what they saw, the first request stayed pending in the main process
forever. The composer read "Lore is working…" with no card and no way out
except relaunching (final pass 2026-09-07, live store).

## Proposed approach

Every tool that puts a card in front of the owner is `executionMode:
"sequential"` — Pi's own switch, which makes the whole turn run one call at a
time whenever any such tool is in it. No queue in the app; a second card
cannot exist until the first is answered.

## Acceptance criteria

- [x] Each owner-facing tool declares sequential execution.
- [x] A turn holding two owner cards shows the first, then the second, and
      both results reach the agent.
