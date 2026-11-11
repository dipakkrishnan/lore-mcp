---
id: XC-083
title: Measure the CI changes over the 50 runs after each lands
priority: P2
effort: XS
component: cross-cutting
status: completed
related: [XC-077, XC-078, XC-080, XC-081, XC-072, APP-247, XC-084, XC-130]
blockers: [XC-077]
dependencies: []
github_issue: null
created: 2026-10-27
updated: 2026-11-09
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

The whole stack merged on 2026-10-27 between 13:50Z and 13:58Z, so every window
starts there. `docs/backlog/agents/measure_ci_window.py` computes all six rows
from the Actions API (runs, each run's `Desktop macOS checks` job, and that
job's log for the `agents` first attempt, the `K of N walks passed on retry.`
line and the cache lines) and prints a Markdown table with the value, the
baseline and a verdict, or "window too short" until 50 runs (200 for XC-081)
are in:

```sh
uv run python docs/backlog/agents/measure_ci_window.py --since 2026-10-27T13:50:00Z --json runs.json
```

Two scheduled Claude routines run it, on 2026-10-29 (the 50-run rows) and
2026-11-02 (the 200-run XC-081 row), and open a `XC-083:` pull request that
pastes the table into this item's Notes, records each figure in the originating
item's `## Notes` with the window's dates, ticks the matching boxes below, and
flips this item to `completed` when all are ticked. If a figure is worse than its
baseline, the PR says so and a new item is filed for the regression rather than
silently reverting.

## Acceptance criteria

- [x] XC-077 (walks two at a time): over the 50 `tests.yml` runs after it lands,
      the `Desktop macOS checks` job's failure rate is no worse than the baseline
      of 48 of 228 macOS jobs (21.1%) over Oct 20-26, 2026.
- [x] XC-078 (skip the desktop job for PRs that touch nothing it walks): over
      the 50 pull-request runs after it lands, the share of PR runs that start a
      macOS job is about 68% or less (130 of 191 merged PRs in the 30 days to
      2026-10-26 touched a walk input). Count runs where `Desktop macOS checks`
      has a conclusion other than `skipped`.
- [x] XC-080 (retry a failed walk once): over the 50 `tests.yml` runs after it
      lands, `Desktop macOS checks` fails on fewer than 3% of runs (baseline
      21.1%; expected about 0.3%), and the retried-walk count over the same runs
      is recorded alongside it, read from each run's `K of N walks passed on
      retry.` summary line, so the flake rate XC-072 tracks stays visible.
      (Measured 2026-11-09: 18.9%, not met. The miss is recorded below and
      the target moved to XC-130.)
- [x] XC-081 (cancel a PR's superseded run): over the 200 `tests.yml` runs after
      it lands (200, not 50, for this one, as the item filed it), no PR run's
      `Desktop macOS checks` job finishes after a newer run on the same PR has
      already started (baseline 15 runs, 187.4 macOS-min, in the Oct 20-26
      window).
- [x] APP-247 (one connectors walk): over the next 8 green `Desktop macOS
      checks` runs after it lands, the job's median duration is at least 40 s
      lower than without it (the dark connectors walk took a median 52 s, 54 s
      over the last 3 green `main` runs before 2026-10-26), and no check is
      missing from the walk log that the dark run used to make.
- [x] XC-084 (agents walk alone): over the 50 CI runs after it lands, `agents`
      fails its first attempt on no more than 5% of runs (the one-at-a-time
      baseline: 11 of 228 jobs; beside another walk it failed 3 first attempts
      in 4 runs on 2026-10-27), read from each run's `FAIL agents (alone)` log
      groups and `passed on retry` lines.

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

## Reading (2026-11-09)

The two scheduled readings, due 2026-10-29 and 2026-11-02, never opened a PR,
so the reading was taken by hand. It covers every `tests.yml` run in the
window, not only the first 50 or 200:

```sh
uv run python docs/backlog/agents/measure_ci_window.py --since 2026-10-27T13:50:00Z --max-runs 1000
```

(`--max-runs` defaults to 250, newest first. Without raising it, the script
reads only the last week and misses the start of the window.)

515 runs read at 2026-11-09 22:49Z, from 2026-10-27 to 2026-11-09:

| Item | Criterion | Value | Baseline / target | Verdict |
|---|---|---|---|---|
| XC-077 | desktop job failure rate | 58 of 307 (18.9%) | no worse than 21.1% (48 of 228) | met |
| XC-078 | PR runs that start a macOS job | 264 of 414 (63.8%) | about 68% or less | met |
| XC-080 | desktop job failure rate | 58 of 307 (18.9%); 30 walks passed on retry across 28 runs | under 3% | **not met**, moved to XC-130 |
| XC-081 | PR macOS jobs that finished after a newer run on the same PR started | 0 of 414 PR runs | 0 | met |
| APP-247 | median desktop job, last 8 green runs | 6.4 min | at least 40 s under 697 s | met |
| XC-084 | `agents` first-attempt failures | 13 of 294 (4.4%) | 5% or less | met |

XC-082's cache hit on 267 of the 270 runs whose desktop job ran.

For the first 50 runs alone, which is the window the criteria name, the
desktop job failed on 3 of its 29 runs (10.3%).

### Where XC-080's failures came from

- **Main pushes: 11 of 94 (11.7%).**
  - 8 came during GitHub's release-download 504s, 2026-11-09 05:05–07:25.
  - 1 was the store-walk group-header flake, fixed by XC-128.
  - 1 was Node 26's unfinished package (XC-121).
  - 1 was an `npm test` failure on 2026-10-29 (run 40818098677).
  - Without the outage: 3 of 86 (3.5%).
- **Pull requests: 47 of 213.** These span 23 branches. 21 of the failures
  were followed by a green run on the same branch, so many are PRs failing on
  their own changes before being fixed, not flakes. The most were on #663's
  Dependabot branch (8) and on XC-111's move to macos-15 (6).

XC-080's under-3% target is not met. As this item's approach says, the miss
is recorded here and the target moves to a new item, XC-130. XC-130 depends on
XC-124 (the sandbox flake) and XC-126 (the release downloads), the two known
causes left.

APP-247's second clause ("no check is missing from the walk log that the
dark run used to make") is no longer read from the log. APP-269 and APP-270
folded those walks, and XC-108's view-table guard now fails CI if any view is
left unscanned. The latest run scanned 25 of 25 views.
