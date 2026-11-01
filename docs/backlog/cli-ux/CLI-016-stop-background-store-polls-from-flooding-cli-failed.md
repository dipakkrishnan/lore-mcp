---
id: CLI-016
title: Stop background store polls from flooding cli.failed
priority: P1
effort: XS
component: cli-ux
status: ideation
related: [XC-090, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

The desktop polls `lore node sales --json` every 60s (main.cjs SALES_EVERY_MS). While a store is
unreachable, every poll raises, and cli.py sends `cli.failed{node}` with frequency "always". That
is ~4,400 of 4,493 `cli.failed` events from 5 installs, which buries the handful of real failures.

## Proposed approach

Let background read commands (`node sales`, `node views`, and any other poller) opt out of
`cli.failed`. For example, a `LORE_BACKGROUND=1` env var set by the app's pollers, or a
per-command set in cli.py. If store reachability matters, record it as a separate daily event:
`store.unreachable`, at most once a day.

## Acceptance criteria

- [ ] A poll that fails sends no `cli.failed`.
- [ ] A user-started `lore node deploy` that fails still sends it.
- [ ] Test coverage for both paths.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
