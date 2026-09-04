---
id: APP-072
title: Show phase text that matches the running task
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-049]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

Every tool call except `read` sets the live line to "Looking through your
Lore…" (`agent.mjs:461`). During a store deploy that line sits under
"deploying" prose and above the wallet card, telling the owner the app is
reading memories while it is running wrangler or waiting on them.

## Proposed approach

Pick the live text by task and tool: bash under deploy is "Setting up your
store…", a waiting card is no live line at all, search and read under
publish are "Looking through your Lore…". The per-task defaults already
exist in the renderer (`renderer.js:1342`); route tool events through the
same table.

## Acceptance criteria

- [ ] No "Looking through your Lore…" appears in the deploy thread.
- [ ] While a card waits on the owner, no live line claims work is happening.

## Notes

