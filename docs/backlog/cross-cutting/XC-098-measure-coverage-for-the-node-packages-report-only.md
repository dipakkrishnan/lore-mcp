---
id: XC-098
title: Measure coverage for the Node packages, report-only
priority: P2
effort: S
component: cross-cutting
status: completed
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

- [x] Each of `lore/node`, `feedback-relay`, `checkout` and `app/desktop`
      prints statement and branch coverage in its CI job's step summary.
- [x] No job fails on a coverage number; this item is report-only.
- [x] The Worker component tests' wall time grows by no more than 10% with
      instrumentation on (measured on one CI run against the run before).
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream A3 of the test-pyramid plan.
- The CI log already warns that `@cloudflare/vitest-pool-workers` is
  deprecated in favour of `@cloudflare/vitest-plugin`; `feedback-relay` and
  `checkout` pin ^0.22.0 while `lore/node` pins ^0.23.0. Aligning the three
  is in scope here if the coverage provider needs it, not otherwise.
- 2026-10-30, implementation. The provider did not need the pools aligned:
  istanbul instruments inside workerd on both 0.22.0 and 0.23.0, so the pins
  stay. `@vitest/coverage-istanbul` peer-depends on the exact vitest version
  (4.1.12 in `lore/node`, 4.1.11 in the other two); the latest 5.x trips an
  npm peer-resolution crash, so each package pins the version matching its
  vitest.
- Coverage is on with `npm run test:coverage` (vitest `--coverage`), which is
  what the four CI jobs now run; plain `npm test` is unchanged, so a local
  run is not slowed. The config is `test.coverage` in each vitest config;
  the configs switched from `defineProject` to `defineConfig` because
  `coverage` is a root-level option and `tsc` rejects it on a project.
- `lore/node` is two Workers with two configs. Their reports partition
  `src/`: the main config covers `src/**` minus `src/hosted/**`, the hosted
  config covers `src/hosted/**` into `coverage/hosted/` (the hosted Worker
  imports `seal.ts` and `agent.ts` from the main tree, which count once, in
  the main report). `.github/scripts/coverage_summary.py` sums the two
  `total` blocks into the one `lore/node` line.
- The step-summary line comes from `.github/scripts/coverage_summary.py`
  (tested in `tests/test_coverage_summary.py`): istanbul `json-summary`
  files for the Workers, node's lcov reporter for the desktop. A missing or
  unreadable report is a `::warning` and a "not measured" line, exit 0: the
  job's colour still means only that the tests passed.
- The desktop runs `node --test --experimental-test-coverage
  --test-coverage-include='src/**'` with the `spec` reporter to stdout and
  the `lcov` reporter to `coverage/lcov.info`. Two caveats on that line:
  node:test counts lines, not statements, so the line says `lines`; and V8
  coverage knows only the files the tests loaded, so `main.cjs`,
  `preload.cjs`, `renderer.js`, `markdown.js` and `runtime.cjs` are absent
  from the number rather than counted at 0% (15 of 20 `src/` files appear).
  The istanbul reports do the opposite: every `src/**` file counts, loaded
  or not.
- Local numbers at implementation: `lore/node` statements 96.33%
  (1075/1116), branches 89.57% (704/786); `feedback-relay` 100.00%
  (184/184) / 99.27% (136/137); `checkout` 99.51% (202/203) / 98.34%
  (178/181); `app/desktop` lines 92.60% (3368/3637), branches 89.04%
  (1268/1424). Locally the instrumented `lore/node` run was not slower than
  the plain one (63 s against 78 s, both noisy); the CI measurement is what
  criterion 3 asks for and is recorded below.
- CI numbers, PR #614 run 41099570458 (2026-10-30) against the latest green
  main run before it, 40995303688 (XC-088, #608). The three Worker lines
  read from the job logs are identical to the local numbers above:
  `lore/node` statements 96.33% / branches 89.57%; `feedback-relay`
  100.00% / 99.27%; `checkout` 99.51% / 98.34%. The desktop's
  `test:coverage` step (58 s) and its summary step both succeeded with no
  `coverage app/desktop` warning annotation on the job, which is the
  script's only other outcome, so the line carries numbers; the same
  commit on the same OS gave lines 92.60% / branches 89.04% locally, and
  the job's log was still being written (the walks) when this was
  recorded. Criterion 3:
  `Node component tests` took 97 s (job) and 72 s (test step) instrumented
  against 90 s and 66 s before, +7.8% and +9.1%; `Card checkout component
  tests` 19 s against 25 s and `Feedback relay component tests` 25 s against
  22 s, where the job is mostly `npm ci` and a 3 s test step, so those two
  are runner noise either way. The desktop's `npm test` step, outside the
  criterion, went from 42 s to 58 s under `--experimental-test-coverage`.
  Criterion 4: the diff touches nothing under `app/desktop/support/` or
  `app/desktop/src/`; the walks ran unchanged in the same job.
- Every job in the run is green; no coverage threshold exists anywhere to
  fail one (criterion 2). The `Python unit tests` job now also runs
  `tests/test_coverage_summary.py`.
