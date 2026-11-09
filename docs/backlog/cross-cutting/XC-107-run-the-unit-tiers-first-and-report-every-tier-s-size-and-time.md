---
id: XC-107
title: Run the unit tiers first and report every tier's size and time
priority: P2
effort: S
component: cross-cutting
status: completed
related: [XC-097, XC-083, XC-108]
blockers: [XC-097]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
---

## Problem

CI has no notion of test level, so a pull request learns about a broken
pure function only after the component tier that includes it finishes, and
nobody can see from a run whether the suite is getting more top-heavy. The
macOS job runs `npm test`, then the walks, then packaging, with no
fail-fast ordering by cost.

## Proposed approach

Once XC-097 and XC-099 give each package a unit tier, order each CI job to
run its unit tier as the first step and stop on failure, then the component
tier. On macOS: unit, component, the walks, then `npm run package`. Add a
step to each job that prints a per-tier line (tests, duration) into
`$GITHUB_STEP_SUMMARY`, and on the macOS job a line with the number of views
scanned by the walks this run, read from the walks log the way
`docs/backlog/agents/measure_ci_window.py` reads the retry lines. Extend
that script with a `tiers` row so the XC-083 readings carry the pyramid's
shape over time.

## Acceptance criteria

- [x] Every test job runs its unit tier before its component tier and a
      unit failure stops the job before component tests start.
- [x] Each job's step summary has a per-tier table of counts and seconds.
- [x] The macOS job's summary states how many views the walks scanned this
      run.
- [x] `measure_ci_window.py` reports per-tier counts and durations alongside
      its existing rows.
- [x] Layout scan: this item touches no walk; it adds the per-run
      views-scanned line so a drop in scan coverage is visible on every run.

## Notes

- Workstream E1 of the test-pyramid plan.
- 2026-11-09, PR #675, evidence from its CI run 42572078205 (all green).
  - Unit first: the Worker jobs already ran `npm run test:unit` before the
    instrumented run (XC-099). The desktop job's log shows the order
    `npm run check`, `test:unit:coverage`, `uv sync --locked` (moved after the
    unit tier, which needs no Python environment), `test:component:coverage`,
    the walks, `npm run package`; every step is the default `success()`, so a
    failure skips the rest. Python is two jobs, so `python-integration` now
    `needs: python-unit`: on this run unit finished 06:18:32 and integration
    started 06:19:57. The cost is the unit job's 50 s ahead of a 19 s job, far
    inside the desktop job's 10.8 min. The bridge job has no unit tier yet
    (its `npm test` is one stdio script with no count line; XC-103 adds
    `node:test` unit tests, and its job should then get the same table) and
    the site has one tier, reported as one row.
  - Tier tables (`### Test tiers: <package>` in each step summary, from
    `.github/scripts/tier_summary.py`, now one table per job, reading
    node:test, vitest and pytest): Python Unit 1,136 tests 36.9 s (with
    `-n auto`); Python Integration 7, 10.9 s; app/desktop Unit 266, 13.7 s,
    Component 94, 76.8 s; lore/node Unit 61, 0.5 s, Component 166, 56.3 s;
    feedback-relay Unit 24, 0.2 s, Component 64, 3.0 s; checkout Unit 7,
    0.2 s, Component 64, 1.9 s; site Component 119, 4.5 s. A Worker's
    instrumented run repeats its unit project, so its Component row is the
    step's count less the Unit row's (`--also-runs Component Unit`); the
    seconds stay the step's own.
  - Views scanned: `.github/scripts/views_scanned.py` reads the teed walks
    log and `support/views.json`: "25 of 25 views in views.json scanned this
    run (153 shots, 92 again at 900 px); 5 more listed with no walk that
    scans them". Views the table expects but the run missed are named.
  - `measure_ci_window.py --since 2026-11-09T06:16:55Z --max-runs 1
    --tier-runs 1` printed a "Test tiers (XC-107)" table of the eleven rows
    above, "Unit tiers hold 1494 of 2008 (74.4%) of the tests counted", and
    "Layout scan: the latest run scanned 25 of 25 views". It reads the tier
    tables of the last `--tier-runs` (default 10) runs, one log per test job
    each, and the layout-scan line from every desktop log it already reads.
  - Layout scan: no walk, `edge.cjs` or `views.json` changed; the walks step
    passed 22/22 in 491 s on this run with 25 of 25 views scanned.
