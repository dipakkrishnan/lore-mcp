---
id: XC-098
title: Measure coverage for the Node packages, report-only
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-096, XC-099, XC-108]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

`tests/gate.py`'s docstring says it plainly: the Workers have no coverage
measurement, and pretending otherwise would be worse than saying so. None of
`lore/node`, `feedback-relay`, `checkout` or `app/desktop` configures
coverage, and no `@vitest/coverage-*` package is installed. So the plan to
move Worker and desktop tests down the pyramid has no way to show that a move
kept what it replaced. `@cloudflare/vitest-pool-workers` supports the istanbul
provider only (the installed 0.22.0 throws on v8 and names the package to
install), which is why nobody switched it on by accident.

## Proposed approach

Add `@vitest/coverage-istanbul` to the three Workers and set
`test.coverage.provider: "istanbul"` in each workerd vitest config, with
`reporter: ["text-summary", "json-summary"]`. Once XC-099 adds node-environment
projects, those use the v8 provider. For the desktop, run `node --test
--experimental-test-coverage` in CI. In every case, report only: a per-package
line in `$GITHUB_STEP_SUMMARY` with statement and branch percentages. No
floors yet; XC-108 sets them once a few weeks of numbers exist.

## Acceptance criteria

- [ ] Each of `lore/node`, `feedback-relay`, `checkout` and `app/desktop`
      prints statement and branch coverage in its CI job's step summary.
- [ ] No job fails on a coverage number; this item is report-only.
- [ ] The Worker component tests' wall time grows by no more than 10% with
      instrumentation on (measured on one CI run against the run before).
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream A3 of the test-pyramid plan.
- The CI log already warns that `@cloudflare/vitest-pool-workers` is
  deprecated in favour of `@cloudflare/vitest-plugin`; `feedback-relay` and
  `checkout` pin ^0.22.0 while `lore/node` pins ^0.23.0. Aligning the three
  is in scope here if the coverage provider needs it, not otherwise.
