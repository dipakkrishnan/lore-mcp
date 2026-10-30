---
id: XC-109
title: Decide whether the desktop job becomes a required check
priority: P3
effort: XS
component: cross-cutting
status: ready
related: [XC-083, XC-080, XC-084, APP-270, APP-271]
blockers: [APP-270, XC-083]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
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

- [ ] Notes hold the measured failure rate over the 50 runs after APP-270,
      with the run window.
- [ ] The decision and who made it are recorded; if yes, the ruleset change
      is merged.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream E3 of the test-pyramid plan. A decision item with a measurable
  precondition, not implementation work.
