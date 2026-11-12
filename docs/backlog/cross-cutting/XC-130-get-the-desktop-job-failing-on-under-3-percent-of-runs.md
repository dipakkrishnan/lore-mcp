---
id: XC-130
title: Get the desktop job failing on under 3% of runs
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-080, XC-083, XC-109, XC-124, XC-126, XC-128]
blockers: [XC-124, XC-126]
dependencies: []
github_issue: null
created: 2026-11-09
updated: 2026-11-11
---

## Problem

XC-080 set a target: `Desktop macOS checks` should fail on fewer than 3% of
runs. XC-083's reading on 2026-11-09 found 58 failures in 307 runs (18.9%)
between 2026-10-27 and 2026-11-09, so the target is not met.

Main pushes alone failed on 11 of 94 runs (11.7%), for these reasons:

| Cause | Main failures | Status |
|---|---|---|
| GitHub release-download 504s, 2026-11-09 | 8 | XC-126 |
| The store walk's group-header check | 1 | fixed by XC-128 |
| Node 26's unfinished package | 1 | XC-121 |
| An `npm test` failure, run 40818098677, 2026-10-29 | 1 | not looked at |

XC-124's sandbox flake caused no main failure in the window. It did fail
#664's PR run, and #663's PR run on 2026-11-09.

PR runs failed on 47 of 213. Many of those are PRs failing on their own changes
before being fixed: 21 of the failures were followed by a green run on the same
branch. A rate counted over every PR run can't reach 3% for that reason alone.

While the job fails this often, XC-109 keeps it out of the required checks.

## Proposed approach

- Land XC-124 and XC-126, the two known causes still open.
- Find the cause of run 40818098677's `npm test` failure.
- Measure main pushes only, which have no work-in-progress failures. Use the
  first 50 main runs after XC-124 and XC-126 have both merged. Count a walk that
  passes on retry as a flake, as XC-080 does, and report that count alongside.

## Acceptance criteria

- [ ] Over the first 50 main-push `tests.yml` runs after XC-124 and XC-126
      merge, `Desktop macOS checks` fails on fewer than 3% (at most 1 run). The
      reading records the retried-walk count.
- [ ] Each failure in that window is named, with its cause.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- The target was moved here from XC-080 by XC-083, following that item's own
  approach: record the miss and move the measurement to its own item.
- Once this target is met, XC-109's question of making the job required can be
  asked again.

**Prioritization pass 2026-11-11:** Moved `ready` → `in-review`: blockers XC-124 (`ideation`) and XC-126 (`ready`) are not `completed`.
