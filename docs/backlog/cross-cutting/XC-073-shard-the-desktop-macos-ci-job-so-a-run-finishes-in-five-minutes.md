---
id: XC-073
title: Shard the Desktop macOS CI job so a run finishes in five minutes
priority: P1
effort: S
component: cross-cutting
status: in-progress
related: [XC-072, XC-043, APP-066]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

A green CI run (`.github/workflows/tests.yml`) takes 18–21 minutes: the median of
the last 30 green runs is ~1190s, the worst 1814s. Every job but one finishes in
under 2.5 minutes. The whole critical path is the single `desktop-check` job
("Desktop macOS checks", `macos-14`), measured over three green runs on Oct 26:

| Part of `desktop-check` | Time |
|---|---|
| checkout, setup-node, setup-uv, `npm ci` | ~26s |
| `npm test` | 116–135s |
| 22 serial `support/edge.sh <persona>` Electron walks | ~966s |
| `npm run package` | 71–95s |

Three things make the twenty minutes cost more than they look. A flaky walk
(XC-072) fails late and costs a full rerun. The `protect-main` ruleset requires
branches to be up to date, so every merge to `main` makes every other open pull
request run again. And the account's macOS runners are oversubscribed: GitHub
runs at most five macOS jobs at once across the whole account, 17 CI runs started
in one hour on Oct 26, and at ~20 macOS minutes each that is ~340 minutes of macOS
work an hour against 300 of capacity, so runs queue for runners.

That last point decides the design. Splitting the walks into five parallel jobs
(the first version of this item, and #559) brought each job to ~4 minutes, but
the run still took 18.9 minutes: its five jobs started one after another over 11
minutes, waiting behind other pull requests' macOS jobs. When runners are the
bottleneck, what matters is the macOS time a run uses, and splitting does not
reduce it.

## Proposed approach

Run walks side by side on each runner. They were already built for it: each walk
keeps its own Lore home, Electron profile (so the single-instance lock does not
collide), stubbed clipboard and dynamic ports. Measured on `macos-14` (three
cores), all 22 walks on one runner:

| Walks at once | Time | Result | Each walk vs. alone |
|---|---|---|---|
| 1 | ~966s | pass | — |
| 2 | 466s | 22/22 pass | about the same |
| 3 | 511s | 8/22 fail | 2–2.5× slower |

Two at a time is free; three saturates the CPU and fails. So:

- `app/desktop/support/walks.cjs` holds the one list of walks with their measured
  times, runs them two at a time, longest first, and can run one balanced shard
  of K. `npm run test:edge` and CI both run it, so a new walk is one line there and
  CI cannot skip it. That replaces `test/ci-edge.test.cjs`, which only guarded the
  old one-step-per-persona layout.
- CI: `desktop-check` (`check`, `test`, `package`) plus two `desktop-walks` shards
  (~250s of walking each). Three macOS jobs and ~13 macOS minutes a run, down from
  one job and ~20, finishing in about five minutes when runners are free.
- A workflow `concurrency` group cancels a superseded pull-request run, so it
  stops holding macOS runners; pushes to `main` are never cancelled.
- `timeout-minutes: 15` on each macOS job, and `setup-uv`'s cache.

This PR also carries #559's second pruning pass (XC-043 is already `completed`,
so the pass is recorded here): 21 low-signal tests removed, the secret and
recovery-phrase skill checks folded into one scan, local HTTP fixtures polling
every 10ms on shutdown, and the CLI push retry's sleep mocked. Python unit tests
went from ~85s to ~27s locally.

## Acceptance criteria

- [ ] A green CI run on a pull request finishes in under 7 minutes when runners
      are free (was ~20), measured over the 20 runs after this lands.
- [ ] A run uses at most three macOS jobs and about 13 macOS minutes.
- [ ] Every walk in `support/walks.cjs` runs in exactly one shard, and a failing
      walk is named in the log, in an error annotation and in the shard's summary.
- [ ] The Desktop walks' failure rate is no worse than before (XC-072's ~5.7% of
      the old job's walks), measured over the same 20 runs.
- [ ] A second push to a pull request cancels the run in progress for it; pushes
      to `main` are never cancelled.

## Notes

Not done, on purpose:

- Three or more walks per runner: measured above, it fails.
- Walks on Linux runners, which have far more concurrency than macOS: the app is
  a Mac app (sandbox, Keychain, packaging), and the walks would test a different
  platform. Worth revisiting only if macOS capacity stays the bottleneck.
- Skipping the walks for pull requests that touch nothing they exercise: only 15
  of the last 80 merged pull requests would skip.
- The owner's calls: `strict_required_status_checks_policy` in
  `.github/rulesets/protect-main.json` (keeping it means every merge still makes
  every open pull request rerun, now ~5 minutes), and making the desktop jobs
  required checks (wait for XC-072).

When a walk is added, give it its time alone in `support/walks.cjs`; the shards
rebalance themselves. If a shard drifts past ~5 minutes, add a shard rather than
a third walk at a time.
