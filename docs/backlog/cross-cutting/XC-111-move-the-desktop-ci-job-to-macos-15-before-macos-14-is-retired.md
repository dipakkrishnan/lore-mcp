---
id: XC-111
title: Move the desktop CI job to macos-15 before macos-14 is retired
priority: P0
effort: XS
component: cross-cutting
status: in-progress
related: [XC-083, XC-077, XC-084, XC-072]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

`Desktop macOS checks` in `.github/workflows/tests.yml` runs on `macos-14`.
GitHub is retiring that image on 2026-11-02 (actions/runner-images#13518)
and, to force migrations, fails every `macos-14` job during scheduled
brownouts: 14:00Z to 00:00Z on Oct 29, 30, 31 and Nov 1. On 2026-10-30 the
desktop job on PRs #612 and #614 was cancelled twice with "This job failed
because of a scheduled macOS 14 runner image brownout" and "The job was not
acquired by Runner of type hosted even after multiple attempts". From Monday
the job cannot run at all, which takes the walks, the desktop unit tests and
the packaging check out of CI for every PR.

## Proposed approach

Change `runs-on` to `macos-15`, pinned rather than `macos-latest`, so the
machine class stays fixed while XC-083 measures walk timings; `macos-latest`
can move under the job without a diff. Both labels are arm64 three-core
runners, so `--jobs 2` in `support/walks.cjs` and the `agents` solo rule
(XC-084) carry over; the comments naming the runner are updated. The
packaging cache key uses `runner.os` and `runner.arch`, which are the same
on both, so the whisper.cpp and node builds are reused. The first run on
macos-15 is the measurement: if the walks or `npm test` move materially, the
XC-083 readings note the date the machine changed.

The first macos-15 run (41102891760) found a second difference: the image
ships Homebrew Python 3.15.2, uv picked it ("Using CPython 3.15.2 interpreter
at /opt/homebrew/opt/python@3.15"), and pydantic-core has no 3.15 wheel, so
the first `uv run lore` in `npm test` compiled it from source and the test
that happened to spawn it ("a memory card saves exactly what the owner kept")
timed out at 120 s. macos-14 had no usable interpreter and uv downloaded a
managed CPython 3.12.14 every run, so CI was quietly testing 3.12 while the
app is developed on 3.14 (the Python 3.13 `Path.resolve` change XC-096 fixed
in `lore/sources.py` was invisible to CI for that reason). So the job also
sets `UV_PYTHON: "3.14"`, and `uv sync --locked` moves ahead of `npm test` so
the environment is built once in its own step rather than inside whichever
test runs first.

## Acceptance criteria

- [ ] `Desktop macOS checks` runs on `macos-15` and no file in the repo
      names `macos-14` as the current runner (backlog items that record past
      measurements keep the name as history).
- [ ] The PR's desktop job passes on `macos-15` inside a brownout window,
      with 21/21 walks and the packaging cache restored.
- [ ] The walks step time on that run is recorded in Notes beside the
      macos-14 figure from the latest green main run (394 s, run
      40995303688), so XC-083's next reading knows whether the machine moved
      the numbers.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Found while merging the test-pyramid phase-0 PRs on 2026-10-30: #612's
  desktop job was cancelled by the brownout, re-run, and cancelled again.
- `macos-26` exists as well; it is newer than what the owner's desktop app
  targets today and a bigger jump for the Electron and whisper.cpp builds, so
  `macos-15` is the conservative move.
