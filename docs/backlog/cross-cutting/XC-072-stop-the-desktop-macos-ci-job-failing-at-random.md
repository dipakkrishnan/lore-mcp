---
id: XC-072
title: Stop the Desktop macOS CI job failing at random
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [APP-066, XC-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-20
updated: 2026-10-20
---

## Problem

The `Desktop macOS checks` job (`desktop-check` in `.github/workflows/tests.yml`,
`macos-14`) fails on code that did nothing wrong. Of the 456 runs of that job
across the last 100 CI runs (Oct 5 to Oct 20), 26 failed (5.7%), and the rate is
climbing: none failed Oct 5-11, 1-4 a day Oct 12-18, 12 on Oct 19. The failures
land on unrelated pull requests (docs, dependabot, test-only worker PRs) and on
pushes to `main`, so a red check here says almost nothing about the change under
review. The result is reruns, stalled merges (the repo requires green checks and
up-to-date branches, so every rerun is a full cycle), and a real regression that
would be waved off as "the flaky one".

## Proposed approach

Treat it as several small flakes, not one. Roughly in order of how often they
hit:

1. **Waits that give up too early.** `support/edge.cjs` reads the page right
   after a short fixed wait: `copyMessage`/`copyLink` poll 20 x 50ms (1s) for a
   clipboard write, `waitFor(..., 20)` polls 20 x 250ms (5s) for the "Copied"
   state, and the `connectors` walk reads `#content` as soon as
   `todayShown` is true, which can still be the "Loading…" state. Replace each
   fixed read with a wait on the thing being asserted (poll the condition, not
   the clock), with a generous ceiling that is only hit when something is truly
   wrong.
2. **The `agents` walk hanging.** It starts a Python stand-in node
   (`tests.fixtures.inbox serve`) and drives a relaunching Electron app; two
   failures hit the 180s watchdog in `edge.sh`. The watchdog already writes a
   `sample` of the main process to `hang.txt`; upload `$root` (walk log,
   `hang.txt`, `agent.log`, screenshots) as a workflow artifact on failure so
   the next hang can be read instead of guessed at.
3. **Temp-dir cleanup race in `npm test`.** `ENOTEMPTY ... rmdir
   .../lore-sandbox-*/lore` appears when a test's sandbox is removed while
   something is still writing to it. Make the teardown wait for (or stop) the
   writer, or retry the removal.
4. **Rerun-on-failure is not the fix.** Do not add a blanket retry to the job:
   it would hide the signal. If a retry is added at all, scope it to the single
   walk, report it, and cap it at one.

Do this one flake at a time, measuring the job's failure rate over the next ~100
runs after each change, so the item is done when the rate is, not when the code
looks right.

## Acceptance criteria

- [ ] On failure the `Desktop macOS checks` job uploads each walk's `$root`
      (`walk.log`, `hang.txt`, `agent.log`, screenshots) as a workflow artifact.
- [ ] The `connectors` walk's Today check, and the `copyMessage`/`copyLink` and
      "Copied" waits, poll their own condition instead of reading after a fixed
      delay.
- [ ] The `lore-sandbox-*` `ENOTEMPTY` failure in `npm test` no longer occurs.
- [ ] Over the 100 CI runs after the last change lands, `Desktop macOS checks`
      fails on at most 1 run, and every failure has a cause attributable to the
      change under test.

## Notes

Evidence below was gathered on 2026-10-20 from the job and log data of the last
100 `tests.yml` runs (`gh api repos/.../actions/runs/<id>/jobs`, `gh run view
--log-failed`). "Verified" means read directly from those runs; "suspected"
means a hypothesis the data fits but does not prove.

**Verified**

- 26 of 456 runs of the job failed (5.7%). By day: Oct 12: 1, Oct 13: 1,
  Oct 16: 3, Oct 17: 4, Oct 18: 4, Oct 19: 12, Oct 20: 1. No failures Oct 5-11.
- Failed step: `edge.sh agents` 13, `edge.sh connectors` 6, `npm test` 4,
  `edge.sh seller` 2, `edge.sh store` 1.
- Failures hit unrelated work: `main` pushes (5, e.g. `347769b`, `4329609`),
  dependabot, docs (`doc-003-hosted-nodes`), and test-only worker PRs.
- Five failures passed on a retry of the same sha (`d6bbcaf`, `dda5c7e`,
  `ce4d055`, `842071f`, `a3007de`). One retried and failed again (`a4ff3be`,
  with a different signature the second time).
- Distinct failure signatures, not one:
  - `FAIL …and the link says it copied`: 9 runs, Oct 16-18.
  - `FAIL Today points a new owner at connecting their AI…` with the page text
    `Loading…`: 6 runs, Oct 19-20.
  - `FAIL agents timed out` (the 180s watchdog): 2 runs.
  - `ENOTEMPTY ... lore-sandbox-*` in `npm test`: 2 runs.
  - Singletons: `keyboard focus shows the same card`; `a completed deploy opens
    with fresh history` (page text still `Reading this…`); `another save lands
    while the owner is on Connectors` (2); an Activity shimmer check (3 lines,
    one run).

**Suspected, not verified**

- The `Loading…` and `Reading this…` failures are the walk reading the page
  before the renderer finished (a race in `edge.cjs`, not the app). Fits the
  page text captured in each failure; not reproduced locally.
- The `ENOTEMPTY` failures are a teardown race on the shared sandbox directory.
- Runner load or slowness on `macos-14` makes every one of these more likely.
  The failure rate rose as CI volume rose (90 job runs on Oct 19 against a
  typical 10-50), which fits, but the job's durations were not compared.
- The `link says it copied` signature disappears after Oct 18 02:13. That check
  was only renamed (to `…and it says it copied`) in APP-217 (#481, Oct 18) with
  the same 5s wait, so its disappearance is **not** evidence that it was fixed.

Related: `APP-066` (renderer tests in CI) already flagged that the personas
might prove "too slow or flaky" to gate every PR. This item is that coming true
for the Electron walks.
