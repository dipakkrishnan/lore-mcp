---
id: XC-107
title: Run the unit tiers first and report every tier's size and time
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-097, XC-083, XC-108]
blockers: [XC-097]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
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

- [ ] Every test job runs its unit tier before its component tier and a
      unit failure stops the job before component tests start.
- [ ] Each job's step summary has a per-tier table of counts and seconds.
- [ ] The macOS job's summary states how many views the walks scanned this
      run.
- [ ] `measure_ci_window.py` reports per-tier counts and durations alongside
      its existing rows.
- [ ] Layout scan: this item touches no walk; it adds the per-run
      views-scanned line so a drop in scan coverage is visible on every run.

## Notes

- Workstream E1 of the test-pyramid plan.
