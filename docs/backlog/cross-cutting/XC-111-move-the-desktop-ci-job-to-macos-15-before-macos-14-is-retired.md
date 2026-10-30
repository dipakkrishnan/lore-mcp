---
id: XC-111
title: Move the desktop CI job to macos-15 before macos-14 is retired
priority: P0
effort: XS
component: cross-cutting
status: completed
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

The second macos-15 run (41104867595) passed the unit tests but failed the
`connectors` and `reading` walks at the Granola sign-in, four attempts out of
four, while the same walk passed locally. Running the sign-in on the runner
by hand (run 41111873597) showed it was not hanging but slow: 35.9 s from a
shell and 35.7 s spawned from node the way the app spawns it, with the
stand-in server seeing the first request only at the end. The walks wait
less than that. `socket.getfqdn("127.0.0.1")` takes 35.01 s on the macos-15
image (run 41114041681) and returns `localhost`; Python's
`HTTPServer.server_bind` calls it to name the server, and `Loopback`, the
sign-in's browser landing, is an `HTTPServer`. So `lore/signin.py`'s
`Loopback` now binds and names itself by its address with no lookup, pinned
by a test in `tests/test_hosted.py` that fails if `socket.getfqdn` is
called. On that runner the connect went from 36 s to 3.6 s. This is a user
fix too: on any Mac whose resolver is slow to answer for 127.0.0.1, every
hosted sign-in stalled half a minute before the browser opened.

## Acceptance criteria

- [x] `Desktop macOS checks` runs on `macos-15` and no file in the repo
      names `macos-14` as the current runner (backlog items that record past
      measurements keep the name as history). `tests.yml`, `walks.cjs`,
      `docs/test-plan-handoff.md` and `docs/hosted-nodes.md` updated; the
      remaining mentions are all under `docs/backlog/`.
- [x] The PR's desktop job passes on `macos-15` inside a brownout window,
      with 21/21 walks and the packaging cache restored. Run 41114041681,
      job 124263579243, started 2026-10-30T19:17Z (the Oct 30 window is
      14:00Z to 00:00Z): `21/21 walks passed in 565s, 2 at a time`, `Cache
      restored from key: packaging-macOS-ARM64-f63d…`, `npm run package`
      21 s.
- [x] The walks step time on that run is recorded in Notes beside the
      macos-14 figure from the latest green main run (394 s, run
      40995303688), so XC-083's next reading knows whether the machine moved
      the numbers. See Notes: 565 s, with one retry.
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it. The 21 walks ran
      unchanged on macos-15 and passed.

## Notes

- Found while merging the test-pyramid phase-0 PRs on 2026-10-30: #612's
  desktop job was cancelled by the brownout, re-run, and cancelled again.
- Timings on macos-15 (run 41114041681, inside a brownout window with the
  arm64 pool under migration load): `npm ci` 21 s, `npm test` 67 s (42 s on
  the last macos-14 main run), walks 565 s against 394 s, package 21 s with
  the cache hit. `agents` failed its first attempt at 191 s running alone
  (load 16.4) and passed on retry at 157 s, so `1 of 21 walks passed on
  retry`; the other 20 passed first time. Whether the slower walks are the
  machine or the day is for XC-083's next reading; the Oct 29 reading was
  taken on macos-14 and the Nov 2 one will be the first on macos-15, so that
  reading should say the runner changed on 2026-10-30.
- Besides the runner label this PR carries: `UV_PYTHON: "3.14"` on the job
  (CI had been testing on a managed Python 3.12 that uv fetched because the
  macos-14 image had no usable interpreter, while the app is developed on
  3.14); `uv sync --locked` ahead of `npm test`; the `Loopback` fix above;
  and two walk diagnostics in `support/edge.sh` that stay: Electron's stderr
  is kept as `app.log`, and a `sitecustomize` hook on `PYTHONPATH` writes a
  cancelled CLI's Python stack to `cli-stack.log`; both are printed with the
  stand-in servers' logs when a walk fails. Without them the cause above
  could not be read from CI.
- A repo-wide Python pin (a `.python-version`) would make every `uv run`
  agree with the desktop job; left for the owner, since it also moves local
  development and the Linux jobs.
- `macos-26` exists as well; it is newer than what the owner's desktop app
  targets today and a bigger jump for the Electron and whisper.cpp builds, so
  `macos-15` is the conservative move.
