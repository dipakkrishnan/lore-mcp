---
id: XC-084
title: Run the agents walk alone on the CI runner
priority: P1
effort: XS
component: cross-cutting
status: completed
related: [XC-077, XC-080, XC-072, XC-083]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-27
updated: 2026-10-27
---

## Problem

XC-077 runs the desktop walks two at a time on the 3-core `macos-14` runner.
Its first CI run passed all 22 walks in 510 s (466 s in the local measurement),
but the next three runs each lost `agents` on its first attempt:

| run | `agents` | what failed |
|---|---|---|
| 40451983212 (#574) | pass, 229 s | |
| 40453328096 (#575) | FAIL, 299 s | "a save lands while Lore's window is closed" (`edge.cjs`), plus `schedule` |
| 40453328096 rerun | FAIL, 209 s | "Claude gets its own sheet, waiting for its first save" and the three checks after it |
| 40453988442 (#577) | FAIL 87 s, then pass on retry 244 s | "the sheet counts what Grok Bot saved" (`readAfterMs` 17,355), plus `schedule` |

Three first-attempt failures in four runs, against 11 `agents` failures in 228
jobs (about 5%) when the walks ran one at a time (XC-080's Problem section).
Every failing check is a wait on something the walk's stand-in node or the app
should do within a fixed time: a save arriving, a sheet counting it, a first
save being heard. `agents` makes 258 app CLI calls and 105 nested fixture calls,
each a Python start-up, and it was already the walk most slowed by the runner
(215 s there against 122 s locally, STO-006). Beside another Electron walk, with
the queue sorted longest first so `automations` (96 s) and then `connectors`
start next to it, those waits run out. XC-080's retry turns the red into a
green at the cost of about 4 minutes (`agents` again, alone this time, after
everything else): run 40453988442's walks took 800 s against 510 s.

## Proposed approach

Give a walk in `support/walks.cjs` a `solo: true` flag, and set it on `agents`.
A solo walk runs with nothing beside it: all solo walks go first, one after
another, before the shared pool starts; the rest run `--jobs` at a time as
before; a solo walk that failed is retried last, alone again, after the shared
pool has drained (XC-080's rule that a retry never delays a first attempt
still holds, and a retry never changes what runs beside a walk).

Expected cost: `agents` alone is about 215 s on the runner, and the remaining
20 walks (APP-247 removes the dark `connectors` run) sum to 663 s by the
`seconds` in `walks.cjs`, so two at a time about 330 s: roughly 550 s of walks
against the 510 s measured with 22 walks two at a time, about one minute more
per green job, and a job still about 12-13 minutes against 19 before XC-077.
Against that, a first-attempt `agents` failure costs about 4 minutes of retry
and, under XC-078's filter, happens on most PRs that touch the app.

The walks step's cap goes from 15 to 20 minutes at the same time: run
40454899712 (#579) hit the 15-minute cap on a slow runner when `agents` failed
and its retry ran last, and a step that times out prints no summary table and
saves no cache. Twenty minutes is still inside the 19-minute job XC-077
replaced.

The flag is data, not policy: if XC-072's condition waits land and `agents`
stops failing beside a neighbour, drop the flag and the two minutes come back.

## Acceptance criteria

- [x] `support/walks.cjs` runs a walk marked `solo` with no other walk in
      flight, first attempts before the shared pool and any retry after it, and
      `test/walks.test.cjs` proves no other walk starts or ends inside a solo
      walk's window.
- [ ] The implementing PR's `Desktop macOS checks` run shows `agents` passing on
      its first attempt alone, and the job finishes in under 14 minutes.

The trailing check, "over the 50 CI runs after it lands, `agents` fails its first
attempt on no more than 5% of runs (the one-at-a-time baseline)", moved to
XC-083.

## Notes

Filed 2026-10-27 from the first four CI runs of XC-077, while the XC-077 stack
(#574 to #580) was open and unmerged; it sits at the top of that stack so each
item below it stays as reviewed. The alternative, leaving XC-080's retry to
absorb the failures, was set aside: a retry hides the rate XC-072 is driving
down, costs more minutes than running `agents` alone, and `schedule` failed
beside `agents`'s neighbours too (twice in four runs), which the solo phase also
changes, since `schedule` then shares the runner with one short walk rather than
with the tail of `agents`.

First run with the flag, 40456592452 (#581, 2026-10-27): `PASS agents (alone)
(208s)` on its first attempt, 21 of 21 walks in 646 s with none retried, job
14 min 18 s of which about 75 s was XC-082's one-off cache-miss build; the
second criterion stays open until a run lands under 14 minutes.

The run ids in the Problem table are the evidence; the per-check timings come
from the FAIL lines XC-077's `edge.sh` change now prints into the log group.
