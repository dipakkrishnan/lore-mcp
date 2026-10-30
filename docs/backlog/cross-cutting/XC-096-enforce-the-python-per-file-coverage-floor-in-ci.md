---
id: XC-096
title: Enforce the Python per-file coverage floor in CI
priority: P1
effort: S
component: cross-cutting
status: in-progress
related: [XC-083, XC-097, XC-105]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

`tests/gate.py` holds every file in `lore/` to 90% statement coverage and 90%
branch coverage, checked separately per file, and its docstring explains why
one global `fail_under` is not enough. CI never runs it. The `python-unit` job
in `.github/workflows/tests.yml` is `uv run python -m unittest discover -s
tests -v`, with no coverage at all, and `pyproject.toml`'s `fail_under = 90`
is never evaluated either. The floor exists only in a docstring and in
`README.md`, so a module can lose its tests and nothing in the pipeline
notices. The test-pyramid plan (2026-10-30) needs a real floor before any test
is moved or retired, because the floor is what proves a move lost nothing.

## Proposed approach

In the `python-unit` job, replace the bare `unittest discover` with
`uv run python -m coverage run -m pytest tests` followed by the per-file check
`tests/gate.py` already implements (either by calling `gate.py` with a flag
that skips the Worker steps, which `tests.yml` runs as their own jobs, or by
lifting the per-file check into a small `--python-only` mode). Print the
per-file table into `$GITHUB_STEP_SUMMARY`. The first run on a branch will
list the files under 90/90; file each one as its own item rather than lowering
the floor or excluding the file. Fix the pre-existing local failure in
`tests/test_sources.py:530` on the way: the looping-vault test compares a
`/private/var` path to a `/var` one on macOS, so the suite is red locally
before any change is made.

## Acceptance criteria

- [x] The `python-unit` job runs the suite under `coverage` and fails when any
      `lore/` file is under 90% statements or 90% branches, checked per file.
- [x] The job's step summary shows the per-file table so a reader sees which
      file moved without opening the log.
- [x] Every file the first run reports under the floor has a backlog item
      naming it; the floor is not lowered and no file is excluded.
- [x] `uv run python -m pytest tests` is green locally on macOS, including the
      looping-vault case in `tests/test_sources.py`.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream A1 of the test-pyramid plan. The floor is the foundation the
  Python extractions (XC-105) are measured against: an extraction that lowers
  a file's coverage is visible on the PR that makes it.
- `python-floor.yml` runs `test_cli.py` on Python 3.10 and is unchanged.

**Completed 2026-10-30.**

- `tests/gate.py --python-only` runs `coverage run -m pytest -q`, then the
  existing per-file check, prints the table as Markdown, and appends it to
  `$GITHUB_STEP_SUMMARY` whenever that variable is set (a suite failure writes
  one line there instead). The Worker steps are skipped under the flag, since
  `tests.yml` runs them as their own jobs. Without the flag nothing changed
  for local callers except a flushed heading. `--python-only --require-node`
  is rejected as meaningless. ruff, ruff format and mypy are clean on it.
- The `Python unit tests` job (its name is a required check, so unchanged)
  now runs `uv run python tests/gate.py --python-only` in place of the bare
  `unittest discover`.
- First local run (macOS, Python 3.14.6, 1020 passed, 1 skipped): every
  file in `lore/` is at or above 90/90 except one, `lore/cloudflare.py` at
  90.5% statements and **57.1% branches** (14 branches, 6 partial; lines
  75-76, 93, 102, 123, 127-129 missed). Filed as **XC-110** rather than
  lowering the floor or excluding the file. The first CI run of the job on
  PR #611 (run 41094876180) was red on exactly that row, which is the floor
  enforcing itself: a grace list keyed by item id would be the exclusion this
  item forbids. XC-110 then landed as the PR's second commit (seven test
  cases, no production change; `lore/cloudflare.py` 100.0% / 100.0%), so the
  floor arrives green: 1027 passed, every file at or above 90/90.
- The looping-vault failure (`tests/test_sources.py:530`) was a production
  bug, not a test bug. Python 3.13 changed `Path.resolve()` to stop raising
  `RuntimeError` on a symlink loop and return the path resolved as far as it
  got; `Obsidian._located`'s `except RuntimeError` was dead on 3.13+, so a
  looping vault came back half-resolved (`/private/var/...` on macOS, where
  `/var` is itself a link) instead of as Obsidian names it, which is the
  behaviour APP-215 pinned. Linux CI never saw it because `/tmp` is not a
  link. Fixed in `lore/sources.py`: a located path that is still a link is
  one that loops, so it is offered as named; the `RuntimeError` branch stays
  for Python 3.10-3.12. The test is unchanged.
- Layout scan: no walk, view or desktop file is touched (`tests/gate.py`,
  `.github/workflows/tests.yml`, `lore/sources.py`, two backlog items and
  the index).
