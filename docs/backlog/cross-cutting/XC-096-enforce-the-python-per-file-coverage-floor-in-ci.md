---
id: XC-096
title: Enforce the Python per-file coverage floor in CI
priority: P1
effort: S
component: cross-cutting
status: ready
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

- [ ] The `python-unit` job runs the suite under `coverage` and fails when any
      `lore/` file is under 90% statements or 90% branches, checked per file.
- [ ] The job's step summary shows the per-file table so a reader sees which
      file moved without opening the log.
- [ ] Every file the first run reports under the floor has a backlog item
      naming it; the floor is not lowered and no file is excluded.
- [ ] `uv run python -m pytest tests` is green locally on macOS, including the
      looping-vault case in `tests/test_sources.py`.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream A1 of the test-pyramid plan. The floor is the foundation the
  Python extractions (XC-105) are measured against: an extraction that lowers
  a file's coverage is visible on the PR that makes it.
- `python-floor.yml` runs `test_cli.py` on Python 3.10 and is unchanged.
