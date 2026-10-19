---
id: APP-219
title: Today shows only what came in and what to do next
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-214, APP-218]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-19
---

## Problem

On a store with history, Today still stacks old sections under the new top:
Earned, a stats line that clips at the window's edge, and threads that stopped
days ago listed as Unfinished. On Automations, Recent runs shows the agent's
raw cost ("$0.016121"), repeats identical store updates row after row, and
marks each with a grey chip. Each sale's receipt is a boxed "↗" that reads like
an unexplained logo.

## Fix

- Today shows what came in, the one next step and drafts to approve.
  Earned and the stats line are gone; sales live on Inventory › On sale.
- Unfinished lists only threads working now or touched in the last day.
- Recent runs shows no cost, folds repeated runs into one row, and uses a dot
  and a word for state.
- A sale's receipt is a plain "Receipt" link.

## Acceptance

The edge `sales` walk seeds an owner-like history and checks each point above.

## Notes

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in 418c7c3. Closed out in the review-queue pass.
