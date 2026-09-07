---
id: APP-097
title: Keep a finished thread's context when the owner follows up
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-023, APP-047, APP-083]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

Every publish turn closes as `done` because drafts are approved on cards, not
by the agent. The next thing the owner types into that same thread ("how do
you think this will sell?") then starts a brand-new session: the agent
re-reads the skill and answers as if nothing had been said, while the screen
still shows the whole earlier exchange (final pass 2026-09-07, live library).

## Proposed approach

A finished thread is still the thread on screen. When the latest record for a
task is `done` with phase `Finished`, fork the new session from that file
(Pi's own `SessionManager.forkFrom`) so the agent keeps the conversation;
only **Start over** (`Started over`) begins cold. Forked sessions count as
resumed, so the skill prefix is not sent again.

## Acceptance criteria

- [x] A follow-up typed into a finished publish thread continues with the
      earlier turns in context.
- [x] Start over still produces an empty session.
- [x] Thread history after relaunch shows the continued conversation once.
