---
id: XC-080
title: Retry a failed desktop walk once, and report every retry
priority: P1
effort: S
component: cross-cutting
status: completed
related: [XC-072, XC-077, XC-083]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-27
---

## Problem

The `Desktop macOS checks` job (`desktop-check`, `.github/workflows/tests.yml:49-116`)
fails on about one run in five. Over the 200 `tests.yml` runs from Oct 20 19:25Z
to Oct 26 14:55Z, 48 of 228 macOS jobs failed (21.1%). The code under test is
mostly not the cause: 7 of 38 pushes to `main` (18.4%) failed on a tree that had
just passed as a PR, and 16 of 78 PR runs (20.5%) failed on PRs that touched no
file the walks read. Only about 6 points of the 26.9% rate on PRs that do touch
the app looks like real breakage.

The job fails this often because it is 22 independent dice rolls. Each walk is
its own step (`tests.yml:70-115`, `connectors` twice), and across 3,838 executed
`support/edge.sh` steps 45 failed: 1.17% per walk. Compounded over 22 walks that
predicts a 22.8% job failure rate, against 21.1% observed. No one walk owns the
problem: `agents` 11, `update` 8, `settings` 7, `connectors` (dark) 5, `schedule`
5, `connectors` (light) 3, `today`, `sales` and `seller` 2 each, `npm run package`
2 (`npm test` 0).

A failure costs the whole job. The mean failure point is 9.7 minutes in (median
9.1, n=40; 20 of 40 at 10 minutes or later), failed jobs used 557.3 macOS minutes
(16.0%) in the window, and because the job is not a required check
(`.github/rulesets/protect-main.json:41-69`) people push again rather than rerun:
40 of the 48 failures were never rerun, so each flake becomes a new about 19
minute run of everything.

## Proposed approach

Retry at the smallest unit, once, and never silently.

- In the walk runner from XC-077 (`app/desktop/support/walks.cjs`, on
  `origin/xc-073-shard-desktop-ci`), `run(walk)` spawns `support/edge.sh <name>`
  and records `{walk, ok, seconds, load}`. When `ok` is false, run the same walk
  once more, after its siblings in the queue so a retry never delays a first
  attempt, and record both attempts.
- A walk that fails then passes makes the step green, and:
  - prints the first attempt's full `FAIL <walk>` log group as it does today
    (`walks.cjs:95-99`), followed by the second attempt's `PASS` group;
  - emits `::warning title=<walk> passed on retry::<first attempt's FAIL line>`,
    so it appears in the run's annotations (the same `check-runs/<id>/annotations`
    API the investigation used to count never-acquired runners);
  - writes `pass (retry)` in the walk's row of the step-summary table
    (`walks.cjs:112-120`) and a `N of 22 walks passed on retry` line under it.
- A walk that fails twice fails the step, with the `::error` annotation and
  `**FAIL**` row as today. Never a third attempt.
- A walk that hits a watchdog (`edge.sh:261-276`, 180 s default; `walks.cjs:41`,
  8 minutes) counts as a failure and is retried the same way; XC-072 saw two
  `agents` timeouts pass on rerun. Worst case is one extra 6-minute walk.
- Keep the first attempt's evidence. `edge.sh:8` makes a fresh
  `lore-edge.XXXXXX` directory per invocation, so the first attempt's `walk.log`,
  screenshots and `hang.txt` survive the retry; when XC-072's artifact upload
  lands, both attempts' directories go up and the upload must run on `always()`,
  not `failure()`, or a passed-on-retry job uploads nothing.
- If XC-077 does not land, the same loop goes in a small wrapper around
  `support/edge.sh` in each of the 22 steps, with the same warning and summary
  output. Do not reach for a job-level or step-level `retry` action: XC-072 §4
  (`XC-072:51-53`) rules out a blanket job retry, and a step retry hides which
  walk flaked.

This is the retry XC-072 §4 allows, "scoped to the single walk, reported, and
capped at one", and it must not weaken XC-072's last acceptance criterion
(`XC-072:67-69`: at most 1 failure in 100 runs, every failure attributable to the
change). It keeps it honest this way: for XC-072's measurement a walk that passed
on retry counts as a flake, exactly as a red job did before. The number XC-072 is
driving down is "walks that did not pass first time", read from the `passed on
retry` summary lines and warning annotations, not the job's colour. This item
changes what a flake costs (about one extra walk instead of a 19-minute redo),
not whether it is counted.

## Acceptance criteria

- [x] A walk that fails and then passes leaves a `::warning` annotation naming the
      walk and a `pass (retry)` row in the step summary, and the job passes.
- [x] A walk that fails twice fails the job, with the first and second attempts'
      logs both in the step log.
- [x] No walk is ever run more than twice in one job.
- [x] The number of retried walks in any run can be read from its step summary
      without opening the log, and the first attempt's `walk.log` and screenshots
      are kept (and uploaded, once XC-072's artifact step exists).

The fifth criterion as filed ("over the 50 CI runs after it lands, `Desktop macOS
checks` fails on fewer than 3% of runs, with the retried-walk count reported
alongside") cannot be checked in the implementing PR; it moved to XC-083, which
measures both numbers once the window has run.

## Notes

Implemented 2026-10-27 in `app/desktop/support/walks.cjs` (the XC-077 runner):
a failed first attempt is pushed to the back of the queue and run once more; its
`FAIL <walk> ..., retrying` group prints at once without an `::error`, the retry
prints its own `PASS|FAIL <walk> on retry` group, then either `::warning
title=<walk> passed on retry::<first FAIL or ERROR line>` or `::error title=<walk>
walk failed::Failed twice...`. The summary table has one row per walk (light and
dark `connectors` apart), `pass (retry)` where it applies, both attempts' times,
and always a `K of N walks passed on retry.` line; that line is the count to trust,
since GitHub shows at most ten warning annotations per step. `edge.sh` now prints
`FAIL <scenario> said nothing` when a walk logs no check line, so the annotation
text is never empty. `test/walks.test.cjs` runs the runner against a stand-in
`edge.sh` (`LORE_WALKS_EDGE`) that fails on command: it checks the three-way
report, the exact attempt counts (never a third), the light/dark split and the
non-CI output in about a second. The 50-run check moved to XC-083, and XC-072's
Notes now say that for its last criterion a walk that passed on retry counts as a
failure.

Filed from the 2026-10-26 CI investigation (read-only against `main` @ d8530d95);
ranked 3 of 9 in its low-effort list. Expected job failure after one retry per
walk: 22 x 0.0117^2, about 0.3%, assuming attempts are independent. They may not
be when the cause is runner load (XC-072's "suspected" list), in which case the
second attempt fails more often than 1.17% and the rate lands above 0.3%; the 3%
criterion leaves room for that and for real breakage.

What this saves is not rerun minutes (rerun attempts were only 112.8 macOS
minutes, 3.2%, because most failures were never rerun) but the re-pushes and
waiting that a 10-minute-in red forces. It also makes the flake rate countable
across runs for the first time: today a flake on a non-required job mostly shows
up as a second push with a new SHA, which no query can tie to the first.

The 48-of-228 baseline here matches XC-077; XC-072's "26 of 456 runs (5.7%)" is a
step count, as XC-077's Notes explain, and the per-run baseline for Oct 5-20 was
26 of 100.
