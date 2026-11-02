---
id: XC-123
title: Seed the schedule walk so it passes at any hour
priority: P1
effort: XS
component: cross-cutting
status: in-review
related: [XC-072, XC-080, XC-116]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-02
---

## Problem

The `schedule` walk ("the launch catches up on the missed hour with one
reading") failed locally just after midnight on Monday 2026-11-02, twice in a
row, for two agents, while CI was green. The launch caught up two runs: the
Obsidian reading and the weekly "Suggest collections".

That was the walk's seed, not the app. It set up every built-in routine two
days back, so from Sunday 10 AM to Tuesday 10 AM the weekly collections hour
had passed while "Lore was closed" and was rightly owed once. Midnight was a
coincidence of when the agents ran it; CI never ran the walk in that window.
#622 (XC-116) changed the seed to set Lore's other routines up from now, which
fixes the weekday window but leaves three narrower ones: seeded just short of
6 PM on a weekday (the check-in) or 10 AM on a Sunday (collections), the walk
crosses that hour and the launch owes two runs; and run across 9 AM, the
reading it just did is owed again. Each is a few seconds to a minute a day.

## Proposed approach

Pause Lore's other routines in the seed, so only the reading can be owed, and
set the reading's hour twelve hours from the walk's start, so the walk never
crosses it; the walk's Connectors check reads that hour back. Pin the cause in
`tests/test_automation.py` on a New York clock: after two days closed, at
23:59, 00:00 and 00:30 and either side of both 2026 daylight-saving changes,
the launch owes the reading once and nothing else; and with every routine set
up two days back, the Sunday collections are owed once from Sunday 10 AM to
Tuesday 10 AM, which is the app doing the right thing.

## Acceptance criteria

- [x] The clock-pinned tests pass; the second fails if the Sunday hour stops
      being owed after a weekend closed.
- [x] `schedule` passes alone and with `--jobs 2`.
- [x] Every walk, `npm test` and the Python suite green, run serially.
- [x] Layout scan: the walk still shoots `schedule-today-ready` and
      `schedule-connectors`; no view is unscanned.

## Notes

- Product check, same clocks: `next_run` keeps wall-clock hours across both
  changes (9 AM is 9 AM EST the morning after the clocks go back; a 2 AM
  rhythm runs at 3 AM EDT on the day 2 AM does not exist) and a missed hour is
  owed once however many passed. No product change.
