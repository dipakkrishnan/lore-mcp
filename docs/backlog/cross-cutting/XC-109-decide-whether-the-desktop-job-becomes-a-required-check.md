---
id: XC-109
title: Decide whether the desktop job becomes a required check
priority: P3
effort: XS
component: cross-cutting
status: completed
related: [XC-083, XC-080, XC-084, APP-270, APP-271, XC-124, XC-126]
blockers: [APP-270, XC-083]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
---

## Problem

`Desktop macOS checks` is not one of the nine required status checks in the
`protect-main` ruleset; people wait for it by convention. Making it required
at the 2026-10-26 failure rate (21.1% of macOS jobs) would have blocked
merges on unrelated flakes. After XC-080's retry, XC-084's solo `agents`
walk, and the walk retirements, the rate should be far lower, and a job that
is the repo's only end-to-end and layout check arguably should gate merges.
That is the owner's call, with numbers in hand.

## Proposed approach

When APP-270 has landed and XC-083's reading over the following 50 runs
shows the desktop job failing on fewer than 3% of runs, write up the
trade-off (merge safety against flake exposure, with the strict up-to-date
rule still in force) in this item's Notes and put it to Dipak. If the answer
is yes, add the job to `required_status_checks` in
`.github/rulesets/protect-main.json` and note the date; if no, record the
reason and close the item as `completed` with the decision made.

## Acceptance criteria

- [x] Notes hold the measured failure rate after APP-270, with the run
      window. The owner decided after 27 runs rather than 50, and that reading
      is the one recorded.
- [x] The decision and who made it are recorded; if yes, the ruleset change
      is merged. (The answer was no, so the ruleset is unchanged.)
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream E3 of the test-pyramid plan. A decision item with a measurable
  precondition, not implementation work.

## Decision (2026-11-09)

**No.** `Desktop macOS checks` stays out of `required_status_checks`.
@shanedasbach decided this on 2026-11-09, after the test pyramid's last PR
(APP-271, #683) merged. `.github/rulesets/protect-main.json` is unchanged.

The numbers the decision used, from `measure_ci_window.py --since
2026-11-09T08:16:56Z` (APP-270's merge) over the 27 `tests.yml` runs to
13:13Z:

- The script counts 3 failures in 23 desktop jobs (13.0%). Two of them are
  XC-108's proof branches (`xc-108-proof-walks`, `xc-108-proof-views`), which
  were built to fail. That leaves 1 failure in 21 real runs (4.8%), against
  this item's bar of under 3%. That one was #663's Dependabot run
  (42589332181): XC-124's sandbox-cleanup `ENOTEMPTY` flake, this time in the
  read test.
- Most of GitHub's release-download 504s (about 05:05–08:20 UTC) fell before
  this window. Inside it, reruns replaced the failed attempts, so the
  script's count leaves those out. They are what XC-126 is for.
- 4 walks passed only on retry, across 4 runs. `agents` failed its first
  attempt on 2 of 20 runs.
- The median green desktop job took 6.2 min. Main's first run with all seven
  walks (42601890915) took 352 s, with the walks step at 215 s.

Two things still fail this job without the code being wrong: XC-124's
sandbox flake, and GitHub's release-download outages until XC-126 lands.
While either can happen, making the job required would block merges on
causes no PR controls. Revisit only if XC-124 and XC-126
land and the XC-080 rate over 50 runs falls below 3%.
