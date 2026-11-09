---
id: XC-106
title: Try pytest-xdist on the Python component tier
priority: P3
effort: XS
component: cross-cutting
status: completed
related: [XC-097, XC-104]
blockers: [XC-097]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
---

## Problem

The Python suite runs serially: 1,019 tests in 84 s locally and 104 s in CI
on a runner with more than one core. Every test already isolates itself
under a temp `LORE_HOME` (`tests/helpers.py:29-58`), fake servers bind port
0, and `tests/hermetic.py` refuses unstubbed `wrangler`/`npm`, so the
suite looks parallel-safe. Nobody has tried.

## Proposed approach

After XC-097 separates the real-process tests, add `pytest-xdist` to the dev
group and run the component tier with `-n auto` in CI and locally. If a
test fails only under xdist, that is a hidden shared-state bug to fix, not a
reason to pin it serial. Record the before and after times; keep it only if
the CI job gets faster by more than the noise.

## Acceptance criteria

- [x] The `python-unit` job runs with `-n auto` and is at least 20% faster
      than the serial run on the same commit, or Notes record why not and
      the flag is left off.
- [x] Any test that failed under xdist is fixed for the shared state it
      exposed, with the cause in Notes.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream D4 of the test-pyramid plan. An experiment with a clear
  stopping rule; it does not change what is tested.
- 2026-11-04, measured on fc0d74c1 (main after XC-097 part 1), the component
  tier being `tests/` minus `tests/integration/`: 1,110 tests, 1 skipped,
  2,498 subtests. `uv run python -m pytest tests --ignore=tests/integration
  -q -p no:cacheprovider`, wall time on a 10-core M-series laptop:

  | run | wall | pytest's own |
  |---|---:|---:|
  | serial (twice) | 80.2 s, 78.5 s | 78.9 s, 78.1 s |
  | `-n auto` (10 workers, three times) | 16.9 s, 16.8 s, 17.0 s | 16.5 s, 16.4 s, 16.6 s |
  | `-n 4` (twice) | 22.4 s, 22.6 s | 22.1 s, 22.3 s |
  | `-n 2` | 40.1 s | 39.7 s |
  | `-n 16` (oversubscribed) | 12.5 s | 12.1 s |
  | `-n auto --dist loadfile` | 23.0 s | 22.7 s |

  `-n 4` is the number that predicts CI (ubuntu-latest has four cores):
  72% faster than serial locally. Every parallel run passed; eight runs
  across five worker counts and two distributions found no failing or
  flaking test, so no test needed isolating and none is marked serial. The
  premise held: `LoreTestCase` gives each test its own `LORE_HOME`,
  `LORE_STORE` and keyring, `NodeCase`'s stand-in node and `serving()` bind
  port 0, `hermetic.py`'s sandbox is one `mkdtemp` per process, and the
  tests that touch `os.environ` do so in their own worker process.
- Coverage: `tests/gate.py` used to wrap pytest in `coverage run`, which
  measures only the controller process, so under xdist it would have
  reported `lore/` near 0%. It now runs `pytest --cov --cov-report=`
  (pytest-cov, added to the dev group with pytest-xdist): each worker is
  measured, the controller combines them into the one `.coverage` file, and
  `coverage json` reads it as before. The per-file table from `-n auto` is
  byte-identical to the serial one (24 files, all at or above the 90/90
  floor; the floor is unchanged). The gate still passes any unknown argument
  to pytest, so `-n auto` is given by the caller, not baked in: the CI job
  passes it; `tests/integration/` is not run under it.
- Python-unit CI job before this change, on main: 97 s (gate step 88 s) at
  fc0d74c1; 119 s and 130 s on the two commits before XC-097 moved the
  real-process tests out. After: see the 2026-11-09 note.
- Side finding: with pytest-cov active, the full run prints fourteen
  `ResourceWarning: unclosed database in <sqlite3.Connection>` lines
  (test_agents, test_cli, test_inbox, test_usage), serial or parallel; the
  plain run and the old `coverage run` wrapper did not show them, most
  likely because the garbage collector finalised those connections at a
  moment pytest was not capturing warnings (a single test file under
  pytest-cov shows none). They are pre-existing unclosed connections, not an
  xdist effect, and the suite passes; closing them is a separate item.
- 2026-11-09, delivered by PR #661 (merged `bdada87f`); `-n auto` is on.
  `Python unit tests` job on main (`gh run view <id> --json jobs`):

  | run | commit | gate | job | gate step |
  |---|---|---|---:|---:|
  | 42570213129 | `fb25a8e5` (#661's parent) | serial | 108 s | 100 s |
  | 42570854056 | `bdada87f` (#661) | `-n auto` | 38 s | 31 s |

  65% faster on the job and 69% on the gate step. The serial job on ten
  main runs sampled from `fc0d74c1` to `fb25a8e5` ranged 97-126 s (gate
  step 88-117 s), so the change is far outside the noise; there is one CI
  sample after on main so far (the PR's own run 42570236557 took 39 s).
  On the same commit locally (`bdada87f`, 10-core
  M-series): serial `gate.py --python-only --ignore=tests/integration`
  1,118 passed, 1 skipped in 77.4 s; with `-n auto` the same 1,118 in
  18.3 s (76% faster), every file at or above 90/90, and `cli.py`,
  `deploy.py` and `snapshot.py` identical in both tables.
- No test failed under xdist: the eight parallel runs above, the PR's CI
  run 42570236557, main run 42570854056 and the local run here are all green, so
  nothing needed fixing or marking serial.
- Layout scan: #661 touches `tests.yml`, `pyproject.toml`, `uv.lock`,
  `tests/gate.py`, `docs/test-plan-handoff.md` and backlog files, nothing
  under `app/`.
