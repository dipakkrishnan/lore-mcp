---
id: CLI-016
title: Stop background store polls from flooding cli.failed
priority: P3
effort: XS
component: cli-ux
status: in-review
related: [XC-090, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-11-12
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

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Only closing it: confirm the tests and mark it
completed. Prioritization flag (not acted on): done: commit 09ee5c15 (#629)
added POLLED_READS in cli.py and skips cli.failed for those reads.
