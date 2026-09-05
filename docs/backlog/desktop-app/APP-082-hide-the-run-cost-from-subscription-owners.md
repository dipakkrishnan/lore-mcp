---
id: APP-082
title: Hide the run cost from subscription owners
priority: P3
effort: XS
component: desktop-app
status: in-review
related: [APP-007]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

Recent runs shows "Saved what you approved · Sep 5 · $0.03" for every
capture. The owner signed in with a Claude subscription, and Settings tells
them "Your subscription reads and writes your memories with you", so a dollar
figure next to each run has no referent they can act on and reads as a charge
(dogfood 2026-09-05). The number is the estimated model cost from
`owner_jobs.cost_usd`.

## Proposed approach

Show the figure only when the owner signed in with an API key, where it is a
real cost. For OAuth sign-in, leave it out of the row.

## Acceptance criteria

- [ ] With an OAuth sign-in, no run row shows a dollar amount.
- [ ] With an API-key sign-in, the amount still shows.

## Notes

Screenshot `70-dogfood-relaunch.png`.
