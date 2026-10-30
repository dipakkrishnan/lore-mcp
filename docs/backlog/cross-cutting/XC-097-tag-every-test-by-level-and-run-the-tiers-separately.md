---
id: XC-097
title: Tag every test by level and run the tiers separately
priority: P1
effort: M
component: cross-cutting
status: ready
related: [XC-096, XC-099, APP-272, XC-106, XC-107]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
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

- [ ] `tests/integration/` holds the 7 real-process Python tests and nothing
      else; `python-unit` excludes it; `python-integration` runs it on PRs.
- [ ] The real-network install test runs on `python-floor.yml`'s schedule, not
      on PRs.
- [ ] `app/desktop/test/unit/` holds only tests that spawn no process; a
      guard test fails if a unit-folder test requires `support/scratch.cjs`
      or spawns `uv`.
- [ ] The Python and desktop CI jobs print per-tier test counts and durations
      in the step summary.
- [ ] Total test counts are unchanged before and after the move (1,019 Python,
      169 desktop as of main 454fd933, adjusted for whatever lands meanwhile).
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream A2 of the test-pyramid plan. The per-tier numbers are the inputs
  to the budgets in XC-107 and the floors in XC-108.
- `node --test` with no arguments matches `**/test/**/*.cjs`, so files under
  `test/unit/` and `test/component/` are found without a config change (the
  APP-248 notes record the glob and the `test-*` trap).
