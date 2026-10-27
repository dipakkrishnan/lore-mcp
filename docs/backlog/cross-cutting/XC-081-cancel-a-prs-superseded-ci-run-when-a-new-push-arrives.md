---
id: XC-081
title: Cancel a PR's superseded CI run when a new push arrives
priority: P2
effort: XS
component: cross-cutting
status: completed
related: [XC-077, XC-078, XC-083]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-27
---

## Problem

`.github/workflows/tests.yml` has no `concurrency` block (`tests.yml:1-7` go
straight from `on:` to `jobs:`). When a second push lands on a pull request, the
first run keeps going to the end, and its `Desktop macOS checks` job holds one of
the account's 5 macOS runner slots for up to about 19 minutes to produce a result
nobody reads: the check that counts is the one on the new head.

Over the last 200 `tests.yml` runs (Oct 20 19:25Z to Oct 26 14:55Z), 15 PR runs had
a newer run on the same branch created before their macOS job finished. Those 15
jobs used 274.1 macOS-min; 187.4 of those minutes (5.4% of all 3,478.8 macOS-min
in the window) ran after the newer push and would have been saved by cancelling.
The two largest were run 40267796963 (20.4 min, superseded 0.1 min after it
started) and 40327642281 (20.2 min). Nine more PR runs were superseded within 5
minutes of finishing (138 min), which cancelling cannot recover. A separate count
that assumed a flat 20-min run length found 20 of 162 PR runs (12.3%) overlapping
a later run on the same branch; the 15 is the count against actual finish times.

The minutes are small, but they come at the worst time: the same-branch pushes
cluster in the bursts (the Oct 26 13:00 UTC hour started 21 runs whose macOS jobs
asked for 353 macOS-min against the 300 the 5-runner cap can supply) when a held
runner is one another PR is waiting on.

## Proposed approach

Add a top-level `concurrency` block to `tests.yml`, keyed so that pull request runs
on the same PR share a group and pushes to `main` never do:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.ref || github.sha }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```

- For a `pull_request` event `github.ref` is `refs/pull/<n>/merge`, so every run
  of the same PR lands in one group and a new push cancels the in-progress one.
- For a `push` to `main`, keying on `github.sha` gives every push its own group,
  so nothing on `main` is ever cancelled, running or pending.

The tabled #560 branch (`origin/xc-073-shard-desktop-ci`) carries the simpler form
`group: ci-${{ github.workflow }}-${{ github.ref }}` with the same
`cancel-in-progress` expression. Its review on 2026-10-26 found the flaw to avoid
here: `cancel-in-progress: false` only protects the *running* job. GitHub allows
at most one pending run per group, so with `main` runs sharing the group
`ci-CI-refs/heads/main`, a third push while one run is in progress cancels the
second push's pending run, and that SHA never gets a result. Keying `main` on the
SHA sidesteps that. Do not use `github.head_ref` for the PR half: it is the branch
name, which is fine for same-repo PRs but is empty on `push`, and `github.ref`
already distinguishes PRs.

Nothing else changes: no job, step or runner edits.

## Acceptance criteria

- [x] A second push to an open PR cancels that PR's in-progress `CI` run; the run
      shows as cancelled with "a higher priority waiting request" in its
      annotation.
- [x] Three pushes to `main` in quick succession each get a complete `CI` run; no
      `main` run is cancelled, whether it was running or still pending.
- [x] Two different PRs pushing at the same time do not cancel each other.

The fourth criterion as filed ("over the 200 runs after it lands, no PR run's
macOS job finishes after a newer run on the same PR has started") cannot be
checked in the implementing PR; it moved to XC-083.

## Notes

Implemented 2026-10-27 as the block above, verbatim, at the top of `tests.yml`.
Criteria 1 and 3 are verified on the implementing PR by its own second push
(this Notes paragraph); the run ids are recorded in the paragraph below once
observed. Criterion 2 rests on the key: a push to `main` is grouped by
`github.sha`, so no two `main` runs share a group and GitHub has nothing to
cancel or to drop as a second pending run; it was not exercised with three live
pushes to `main` before merge. The 200-run check moved to XC-083.

Filed from the 2026-10-26 CI investigation; ranked 5 of 9 in its low-effort
list. Run and minute figures come from the last 200 `tests.yml` runs via the
Actions API (read-only); the two counts of superseded runs (15 against actual
finish times, 20 against an assumed 20-min run) come from two separate passes
over the same window and are both reported rather than reconciled.

Only 3 runs in the window were cancelled at all (27.4 macOS-min in total, mostly
from jobs that finished before the cancel), so nobody is doing this by hand
today. The 2 jobs cancelled with "a higher priority waiting request for
ci-CI-refs/pull/560/merge exists" show the PR half of the block already working on
the #560 branch.

XC-077 (walks two at a time) cuts the minutes a superseded run can hold; XC-078
(skip the desktop job on PRs the walks cannot see) cuts the number of runs that
start a macOS job at all. This item is independent of both and lands in minutes;
it is listed on the same branch as XC-077's runner because #560 bundled them.
