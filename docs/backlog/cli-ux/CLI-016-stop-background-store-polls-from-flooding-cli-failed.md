---
id: CLI-016
title: Stop background store polls from flooding cli.failed
priority: P3
effort: XS
component: cli-ux
status: completed
related: [XC-090, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-11-13
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

- [x] A poll that fails sends no `cli.failed`.
- [x] A user-started `lore node deploy` that fails still sends it.
- [x] Test coverage for both paths.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Only closing it: confirm the tests and mark it
completed. Prioritization flag (not acted on): done: commit 09ee5c15 (#629)
added POLLED_READS in cli.py and skips cli.failed for those reads.

**Close-out (2026-11-13):** Completed in 09ee5c15 (#629). `lore/cli.py` defines
`POLLED_READS = {("node", "sales"), ("node", "views")}`. `main()` skips
`usage.record("cli.failed", ...)` when `(args.command, args.node_command)` is in
that set. `tests/test_usage.py::test_a_polled_read_that_fails_is_not_a_failed_command`
checks both paths: failing `node sales --json` and `node views --json` send
nothing, and a failing `node deploy` sends `cli.failed{command: node}`. The
optional daily `store.unreachable` event was not built. Nothing asked for it.
