---
id: XC-079
title: Skip the desktop macOS job on pushes to main while the up-to-date rule is on
priority: P2
effort: XS
component: cross-cutting
status: in-review
related: [XC-078, XC-014]
blockers: []
dependencies: ["the protect-main ruleset keeps strict_required_status_checks_policy on"]
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

`tests.yml` runs on every push to `main` as well as on every PR
(`.github/workflows/tests.yml:3-6`), and the `Desktop macOS checks` job
(`desktop-check`, `tests.yml:49-116`) has no condition on the event. In the 200
runs from Oct 20 19:25Z to Oct 26 14:55Z, the 38 pushes to `main` used 632.1 of
3,478.8 macOS minutes (18.2%).

Those minutes re-test a tree that was already tested. The `protect-main` ruleset
sets `strict_required_status_checks_policy: true`
(`.github/rulesets/protect-main.json:39`), so a PR can only merge once its head
is up to date with `main`. A squash, merge or rebase of an up-to-date branch
(all three are allowed, `protect-main.json:29-33`) produces exactly the tree the
PR's last run already walked; nothing new reaches the app between the PR's green
run and the push to `main`. The push run is a repeat, with one difference: it
rolls the job's about 20% flake rate again. 7 of the 38 push runs (18.4%) went
red, every one on a tree that had just passed, and three of them (runs
39831778252, 40267606436, 40327623142) were followed by a green run on `main`
with a diff that touched no walk input. A red `main` that means nothing teaches
people to ignore a red `main`.

## Proposed approach

One line and one comment on the job:

- `desktop-check` gets `if: github.event_name != 'push'` (combined with XC-078's
  condition when both are in: `github.event_name == 'pull_request' &&
  needs.changes.outputs.desktop == 'true'`).
- A comment above it states the precondition in plain words: the skip is only
  sound while `protect-main.json` keeps `strict_required_status_checks_policy`
  on, because that is what makes the merged tree the PR head's tree. If the rule
  is relaxed, or a merge queue is adopted (which would test the tree in a
  `merge_group` run instead, and needs `on: merge_group` added), this line must be
  revisited: removed in the first case, moved to "run on `merge_group`, not on
  `push`" in the second.
- Leave every Linux job running on pushes to `main`. They are the required
  checks (`protect-main.json:41-69`), they cost about 2.5 minutes of free Ubuntu
  time, and they keep a post-merge signal on `main` for everything but the walks.
- Nothing else in `.github/` consumes `desktop-check`'s result (grep,
  2026-10-26); the release workflow does not key off it.

Not in scope: changing the ruleset. Whether to relax strict or move the repo to
an organization for a merge queue is an owner decision the investigation left
open (its finding is that strict updates cost 33% of macOS minutes; this item
only recovers the 18% that strict makes redundant).

## Acceptance criteria

- [ ] A push to `main` starts no macOS job; `Desktop macOS checks` shows as
      skipped in the run and the Linux jobs still run and report.
- [ ] A `pull_request` run still runs `Desktop macOS checks` (subject to XC-078's
      path filter once that lands).
- [ ] The comment on the job in `tests.yml` names the precondition
      (`strict_required_status_checks_policy` in `protect-main.json`) and says what
      to do if strict is relaxed or a merge queue is adopted.
- [ ] Over the 50 pushes to `main` after it lands, no `main` run is red because of
      a walk (baseline: 7 of 38).

## Notes

Filed from the 2026-10-26 CI investigation (read-only against `main` @ d8530d95);
ranked 4 of 9 in its low-effort list. At the owner's review the same day it was
moved to P2 and left in review while the strict/merge-queue question stays open;
the other six CI items went to `ready`. It is the one item on that list whose
soundness rests on a policy staying as it is rather than on code: the dependency
above is a standing condition, not a piece of work. Prioritization should treat
"the owner relaxes strict" as the event that reopens this item.

The merge-queue question is not idle: the investigation found a merge queue is
not available to a personal-account repo (it needs an organization), and that
strict-update re-runs are 62 of 162 PR runs (38%) and 1,150.3 macOS minutes
(33.1%). If the repo moves to an organization and adopts a merge queue, the
`merge_group` run becomes the one that tests the merged tree, and the skip on
`push` stays right while this job gains `merge_group` as a trigger.

XC-014 (completed 2026-08-10) is the item that put the `protect-main` ruleset in
place and checked it into `.github/rulesets/protect-main.json`; it is listed as
related because this item depends on one line of that file staying as it is.
