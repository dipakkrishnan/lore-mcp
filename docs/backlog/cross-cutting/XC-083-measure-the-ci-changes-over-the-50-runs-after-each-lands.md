---
id: XC-083
title: Measure the CI changes over the 50 runs after each lands
priority: P2
effort: XS
component: cross-cutting
status: ready
related: [XC-077, XC-078, XC-080, XC-081, XC-072]
blockers: [XC-077]
dependencies: []
github_issue: null
created: 2026-10-27
updated: 2026-10-27
---

## Problem

Several of the CI items filed from the 2026-10-26 macOS CI investigation carry an
acceptance criterion of the shape "over the 50 CI runs after it lands, X is no
worse than Y". Such a criterion cannot be checked in the pull request that
implements the item, and `docs/backlog/agents/implementation.md` says never to
mark an item `completed` with an unchecked criterion, nor to leave merged work in
`in-progress` (the audit flags stale in-progress items). The sanctioned path is to
record the gap in `## Notes` and split the trailing measurement into its own item.
This is that item, for all of them, so each implementation PR can complete its own
item and move its trailing-window check here.

## Proposed approach

After each listed item merges, wait until 50 `tests.yml` runs have completed on
`main` and on pull requests, then measure with:

```sh
gh run list --workflow=tests.yml --limit 200 --json databaseId,createdAt,conclusion,event
gh run view <id> --json jobs --jq '.jobs[] | select(.name == "Desktop macOS checks") | {conclusion, startedAt, completedAt}'
```

Record the figure in the originating item's `## Notes` with the window's dates and
tick the matching box below. If a figure is worse than its baseline, open a new
item for the regression rather than silently reverting.

## Acceptance criteria

- [ ] XC-077 (walks two at a time): over the 50 `tests.yml` runs after it lands,
      the `Desktop macOS checks` job's failure rate is no worse than the baseline
      of 48 of 228 macOS jobs (21.1%) over Oct 20-26, 2026.
- [ ] XC-078 (skip the desktop job for PRs that touch nothing it walks): over
      the 50 pull-request runs after it lands, the share of PR runs that start a
      macOS job is about 68% or less (130 of 191 merged PRs in the 30 days to
      2026-10-26 touched a walk input). Count runs where `Desktop macOS checks`
      has a conclusion other than `skipped`.
- [ ] XC-080 (retry a failed walk once): over the 50 `tests.yml` runs after it
      lands, `Desktop macOS checks` fails on fewer than 3% of runs (baseline
      21.1%; expected about 0.3%), and the retried-walk count over the same runs
      is recorded alongside it, read from each run's `K of N walks passed on
      retry.` summary line, so the flake rate XC-072 tracks stays visible.
- [ ] Any later CI item from the same investigation that moves a trailing-window
      criterion here (XC-081) has its line added above when its PR merges, and
      that line is measured the same way.

## Notes

- Opened from the XC-077 implementation PR on 2026-10-27, on the plan reviewer's
  finding that leaving XC-077 `in-progress` for weeks would be flagged by every
  audit, while completing it with an unchecked box breaks the implementation
  rules. This sets the precedent for XC-078, XC-080 and XC-081, which carry the
  same shape of criterion.
- Baseline figures come from the 2026-10-26 investigation (per-job 48/228, per-walk
  1.17% compounded over 22 walks predicts 22.8%). Running walks in parallel does
  not change the per-walk rate, but any flake that depends on CPU contention could
  get worse; XC-072's condition waits are the fix for that class.
