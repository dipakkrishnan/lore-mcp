---
id: APP-239
title: Approving the last draft always puts it on sale, even while the window reloads
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-232, APP-233]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-22
updated: 2026-10-22
---

## Problem

On Oct 22 the owner approved a dive piece in its publish thread. It was approved but never pushed: Today showed "1 change isn't live yet", and no push job ran.

`settle()` pushes only after the last card is answered, and it read that from the `candidates` the reload in `act()` fills. Loads overlap, and `load()` drops a load that a newer one overtook. With the agent watch reloading every 10s while Lore is on screen (APP-232/233), the approve's own reload lost, so `candidates` still held the approved card and `settle()` returned without pushing.

## Approach

`settle()` asks the CLI directly for what is still waiting (`candidates` and `extras`) before it decides whether to push.

## Acceptance

- Approving the last draft pushes it, even when another reload overtakes the approve's.
