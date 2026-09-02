---
id: APP-055
title: Close the edge audit's cheap launch-week findings
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-054, MON-013, APP-048, APP-019, XC-020, APP-030]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

Six audit findings that each cost an owner a stall or a dead end, all small
against existing machinery:

- Once a store is open the deploy thread is done and vanishes; nothing in the
  app changes the price or moves off the test network (APP-019 covers a
  native price field; this is the way back into the conversation).
- A push is only offered right after an approval or take-down, so an
  approved publication can sit unseen by buyers indefinitely (MON-013's
  drift, surfaced where the owner acts).
- A memory typed on Today opens an empty thread while the agent resumes the
  last unfinished capture session.
- `desktop-state` probes the node with three sequential HTTP calls at 5 s
  each on every refresh.
- The bash sandbox may read all of `~/.claude` and `~/.codex`, including
  `auth.json` and credential files, while deploy has open network (APP-048's
  neighbour).
- A mistyped API key is stored and only fails inside the first thread.

## Proposed approach

Change price and Switch to real payments buttons on Settings' store card
that reopen deploy with that intent. A standing Push on the For Sale bar,
under Needs you, and in the section hint whenever an approved item is not
live. Root capture opens the unfinished thread with its history. Cache the
probe for a minute and forget it on push. Allow reads only under
`~/.claude/projects` and `~/.codex/memories`. Prove an API key with one
tiny request at sign-in.

## Acceptance criteria

- [x] Settings offers Change price once a store exists, and Switch to real
      payments only while the node reports the test network.
- [x] An approved, unpushed publication shows a Push on For Sale and Today.
- [x] A memory typed on Today lands in the unfinished capture thread.
- [x] Two snapshots within a minute probe the node once; a push forgets it.
- [x] The setup policy allows the agents' project and memory folders and not
      their home roots.
- [x] A bogus API key is refused at sign-in and not kept.

## Notes

Shipped in PR #193, stacked on APP-054's PR #192. The label deliberately
avoids "mainnet"; the row explains that test-network buyers pay with play
money.
