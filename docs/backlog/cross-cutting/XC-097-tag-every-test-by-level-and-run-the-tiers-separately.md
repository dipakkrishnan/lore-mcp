---
id: XC-097
title: Tag every test by level and run the tiers separately
priority: P1
effort: M
component: cross-cutting
status: completed
related: [XC-096, XC-099, APP-272, XC-106, XC-107]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
---

## Problem

Every suite in the repo runs as one undifferentiated block, so there is no way
to say how many tests are unit tests, how long the unit tier takes, or whether
a change made the fast tier slower. The Python suite mixes 1,012 in-process
tests with 7 that start real processes (`tests/test_install.py`, two of which
run `sh install.sh` and one of which reaches the network through `uv tool
install`; `tests/test_cli_smoke.py`; `StoreConcurrencyTest` in
`tests/test_store.py`, which starts four `python -m lore` processes;
`tests/test_deploy.py`'s real offline `npm install`; and the `python -m lore
desktop-state` spawns in `tests/test_snapshot.py` and `tests/test_sources.py`).
The desktop suite mixes in-process tests (`credentials`, `ipc-contract`,
`boundary`, `walks`, `owner`) with ones that spawn the real `lore` CLI or a
real sandbox (`sandbox`, `state-cli`, most of `store` and `agent`). Without
levels, the pyramid's shape cannot be measured, let alone budgeted.

## Proposed approach

Python: move the 7 real-process tests into `tests/integration/`; `python-unit`
runs `tests/` with that folder excluded and a new `python-integration` job runs
it. The network-dependent `test_real_uv_install_produces_a_working_lore_binary`
moves to the weekly cadence `python-floor.yml` already has, so a PR never
depends on PyPI being up. Desktop: `test/unit/` and `test/component/` under
`app/desktop/test`; the in-process tests in `app`, `agent` and `store` split
into the unit folder, the real-CLI and sandbox tests stay component.
`npm test` keeps running both (so `node --test`'s default glob still finds
everything), and the CI job runs them as two named steps. The Worker split is
XC-099's, since it needs a second vitest project rather than a folder. Each
tier's count and duration goes to `$GITHUB_STEP_SUMMARY`.

## Acceptance criteria

- [x] `tests/integration/` holds the 7 real-process Python tests and nothing
      else; `python-unit` excludes it; `python-integration` runs it on PRs.
- [x] The real-network install test runs on `python-floor.yml`'s schedule, not
      on PRs.
- [x] `app/desktop/test/unit/` holds only tests that spawn no process; a
      guard test fails if a unit-folder test requires `support/scratch.cjs`
      or spawns `uv`.
- [x] The Python and desktop CI jobs print per-tier test counts and durations
      in the step summary.
- [x] Total test counts are unchanged before and after the move (1,019 Python,
      169 desktop as of main 454fd933, adjusted for whatever lands meanwhile).
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream A2 of the test-pyramid plan. The per-tier numbers are the inputs
  to the budgets in XC-107 and the floors in XC-108.
- `node --test` with no arguments matches `**/test/**/*.cjs`, so files under
  `test/unit/` and `test/component/` are found without a config change (the
  APP-248 notes record the glob and the `test-*` trap).
- 2026-11-09, what landed, checked against main `bdada87f`. Part 1 is PR #655
  (merged `fc0d74c1`, Python tiers and CI wiring); part 2 is PR #667 (merged
  `680d195f`, desktop tiers). The Worker half was XC-099's (PR #653,
  completed).
  - Integration folder: `tests/integration/` holds five files
    (`test_cli_smoke.py`, `test_deploy_npm.py`, `test_desktop_state.py`,
    `test_install.py`, `test_store_processes.py`) and collects 8 tests, every
    one starting a real process. The item's "7" became 8 because #655 split
    the tilde-source subprocess assertion into its own test. `python-unit`
    runs `tests/gate.py --python-only --ignore=tests/integration -n auto`;
    `python-integration` runs `pytest tests/integration -k "not
    real_uv_install"` (7 tests) on every PR, green on main run 42570854056.
  - Network test: `python-floor.yml` has `schedule: cron "17 6 * * 1"` and a
    `real-install` job gated on `github.event_name == 'schedule'` that runs
    only `-k real_uv_install`. No scheduled run of the workflow is listed
    yet (`gh run list --workflow python-floor.yml --event schedule` is
    empty as of 2026-11-09), so the job is wired but has not run.
  - Desktop tiers: `app/desktop/test/unit/` (19 files) and
    `app/desktop/test/component/` (9 files); `unit/tiers.test.cjs` fails if a
    unit file requires `support/scratch.cjs`, loads `child_process` or
    spawns `uv`, or if a test file is in neither tier.
  - Counts: Python 1,057 -> 1,059 in #655 (+1 from the tilde split, +1
    because the snapshot contract test is now in both tiers); desktop 209 on
    bare main `d4377306` -> 212 in #667, the +3 being `tiers.test.cjs`'s own
    tests. (The item's 1,019 / 169 date from `454fd933`.)
  - Layout scan: neither PR touches `app/desktop/support/` (where
    `walks.cjs` lives) or `app/desktop/src`; the
    walks step passed on main after both landed (run 42566939852, 424 s).
- Not met yet: the step-summary criterion is only half done. The desktop job
  runs "Unit tier in the step summary" and "Component tier in the step
  summary" (`.github/scripts/tier_summary.py`, report-only), both green on
  run 42566939852. The Python jobs do not: `python-unit`'s summary is
  `tests/gate.py`'s per-file coverage table, and `python-integration` writes
  nothing to `$GITHUB_STEP_SUMMARY`. What remains is teeing both Python
  steps to a log and calling `tier_summary.py` on it, as `desktop-check`
  does. No open PR does this; XC-107's "each job's step summary has a
  per-tier table" criterion covers the same ground, so it can land there or
  in a small part 3 here, and this item closes once it does.
- 2026-11-09, closed by XC-107's PR #675. Both Python steps are teed to
  `pytest.log` and end with a `tier_summary.py` step, so on its run
  42572078205 the "Python unit tests" summary has `### Test tiers: Python`
  with Unit 1,136 tests (1,135 passed, 1 skipped) in 36.9 s, and "Python
  integration tests" has Integration 7 tests in 10.9 s. The desktop job's
  two lines became one table on the same run: Unit 266 tests 13.7 s,
  Component 94 tests (1 todo) 76.8 s. Every criterion is now met.
