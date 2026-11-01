---
id: XC-106
title: Try pytest-xdist on the Python component tier
priority: P3
effort: XS
component: cross-cutting
status: ready
related: [XC-097, XC-104]
blockers: [XC-097]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
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

- [ ] The `python-unit` job runs with `-n auto` and is at least 20% faster
      than the serial run on the same commit, or Notes record why not and
      the flag is left off.
- [ ] Any test that failed under xdist is fixed for the shared state it
      exposed, with the cause in Notes.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream D4 of the test-pyramid plan. An experiment with a clear
  stopping rule; it does not change what is tested.
