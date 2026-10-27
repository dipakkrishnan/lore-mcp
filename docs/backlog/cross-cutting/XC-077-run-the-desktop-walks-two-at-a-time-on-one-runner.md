---
id: XC-077
title: Run the desktop walks two at a time on one runner
priority: P1
effort: S
component: cross-cutting
status: ready
related: [XC-072, APP-066]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

The `Desktop macOS checks` job (`desktop-check`, `.github/workflows/tests.yml:49-116`)
runs the 22 Electron walks one after another, each as its own `support/edge.sh`
step (`tests.yml:70-115`). Per-step medians over the last 8 green jobs put the
walks at about 923 s of a job that takes about 19 min green (p50 18.9, p90 21.4,
n=155); with `npm test` (120 s), `npm run package` (83 s) and `npm ci` (14 s)
around them, the walks are roughly 15.5 of those 19 minutes. One walk, `agents`,
is 215 s on its own; the next longest, `automations`, is 96 s; the rest are 8-52 s.

Two attempts to shorten the job by sharding the walks across more macOS jobs
(#559, 5 jobs; #560, 5 jobs) made each job short (4 min or less) but not the run
(16m28s and 18m54s), because the account is capped at 5 concurrent macOS jobs and
GitHub's `macos-14` arm64 pool is itself short at busy hours. During the Oct 26
13:00-15:30 UTC queueing, a macOS job sat queued for 125 min in total, and for 90
of those minutes (72%) this repo had fewer than 5 macOS jobs running; waits
reached 36.5 min and 4 jobs were never given a runner at all. More jobs per run
means more time waiting for a runner, not less time per run. The lever that works
under that cap is macOS minutes per job, with the number of macOS jobs per run
held at one.

## Proposed approach

Run the walks two at a time inside the one existing job, using the runner written
for tabled #560 but without its sharding. `app/desktop/support/walks.cjs` lives on
branch `origin/xc-073-shard-desktop-ci` (head `1c17286d`), not on `main`:

- One list of the 22 walks with each walk's measured seconds (`walks.cjs:16-39`,
  `connectors` appearing twice, light and dark). `--jobs N` defaults to 2
  (`walks.cjs:49`); the queue is sorted longest first (`walks.cjs:63`) so `agents`
  starts at once and the short walks fill in behind it.
- Each walk is spawned as its own process group with an 8-minute limit
  (`walks.cjs:41,80-89`), past `edge.sh`'s own watchdog (180 s default, 300 s for
  `firstrun`, 360 s for `agents`; `app/desktop/support/edge.sh:261-265`), so a walk
  that hangs where `edge.sh` does not watch still ends.
- One walk's output stays together: a `::group::PASS|FAIL <walk> (<s>s, load <n>)`
  block per walk when it ends, an `::error title=<walk> walk failed` annotation on
  failure (`walks.cjs:95-99`), and a pass/fail/time table appended to
  `$GITHUB_STEP_SUMMARY` (`walks.cjs:112-120`).
- Drop the `--shard I/K` option and the shard-balancing loop (`walks.cjs:50,61-68`),
  or leave them unused; this item keeps one macOS job per run.
- In `tests.yml`, replace the 22 `support/edge.sh` steps with `uv sync --locked`
  (run from the repo root, once, before any walk, so two walks starting together
  do not race to build the same virtualenv) and then
  `node support/walks.cjs --jobs 2`. Keep `npm ci`, `npm run check`, `npm test`
  and `npm run package` where they are.
- Point `npm run test:edge` (`app/desktop/package.json:11`, today a `&&` chain of
  20 `support/edge.sh` calls) at `node support/walks.cjs`, so the attended run
  and CI walk the same list. That also retires `app/desktop/test/ci-edge.test.cjs`,
  whose only job (`ci-edge.test.cjs:10-18`) is to fail when `test:edge` names a
  persona with no `run: support/edge.sh` step in `tests.yml`; with one list read by
  both, there is nothing left for it to compare. (Today the two already disagree:
  `test:edge` lists 20 personas and CI runs 22 steps, because only CI runs
  `connectors` dark.)

Measured on `macos-14` (3 vCPU): all 22 walks pass in 466 s two at a time against
about 966 s one at a time, with each walk taking about as long as it does alone.
Three at a time saturates the runner: each walk runs 2-2.5x slower and 8 of 22
failed. One CI run of the `--jobs 3` experiment on the #560 branch also failed.
So the cap is 2.

## Acceptance criteria

- [ ] A green `Desktop macOS checks` job finishes in about 11 minutes (was about
      19; p50 18.9 min over the Oct 20-26 window).
- [ ] A run of `tests.yml` still starts exactly one macOS job.
- [ ] A failing walk is named three ways in the same run: a `FAIL <walk>` log
      group holding that walk's full output, an `::error` annotation on the step,
      and a `**FAIL**` row in the step summary table.
- [ ] `npm run test:edge` and CI run the same list of walks from one place, and
      `test/ci-edge.test.cjs` is gone.
- [ ] Over the 50 CI runs after it lands, the desktop job's failure rate is no
      worse than the baseline: 48 of 228 macOS jobs (21.1%) failed over Oct 20-26,
      which matches the 22.8% predicted from a 1.17% per-walk failure rate
      compounded over 22 walks.

## Notes

Filed from the 2026-10-26 CI investigation (read-only against `main` @ d0ea8057
and d8530d95); ranked 1 of 9 in its low-effort list. The walk timings are
per-step medians over the last 8 green `Desktop macOS checks` jobs; the runner
queue figures are from the last 200 `tests.yml` runs (Oct 20 19:25Z to Oct 26
14:55Z).

Do not raise `--jobs` above 2 on a 3-core runner. The 466 s figure is for
`macos-14`; if the job ever moves to a larger runner, re-measure before changing
the cap.

`XC-073` is the id the tabled #560 branch (`xc-073-shard-desktop-ci`) uses for
its own item; that item exists only on that branch, not on `main`. If #560 stays
tabled, this item supersedes it: same runner, no shards. The #560 review
(2026-10-26) also found a flaw in that branch's `concurrency` block for pushes to
`main`; that is tracked separately in XC-081, not here.

The baseline above corrects the figure in XC-072's Problem section: its "26 of 456
runs (5.7%)" counts steps, not jobs; per run the Oct 5-20 rate was 26 of 100.
Running walks in parallel does not change the per-walk rate, but any flake that
depends on CPU contention could get worse, which is why the 50-run check is a
criterion rather than an assumption. XC-072's work on condition waits is the fix
for that class, and APP-066 first noted that the personas might prove "too slow or
flaky" to gate every PR.
