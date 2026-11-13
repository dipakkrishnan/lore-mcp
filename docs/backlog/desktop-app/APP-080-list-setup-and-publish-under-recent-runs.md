---
id: APP-080
title: List setup and publish under Recent runs
priority: P3
effort: S
component: desktop-app
status: in-review
related: [APP-007]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-11-12
---

## Problem

Right after "Set up your Lore" finished, Today still said "Nothing has run
yet." After a publication was approved, Recent runs listed only the three
captures. Only capture, synthesis and deploy write an `owner_jobs` row
(`lore/cli.py`, `lore/deploy.py`); setup and publish run inside the desktop
agent and record nothing. The section is named as if it were the history of
what Lore did, so a run that is missing reads as a run that did not happen
(dogfood 2026-09-05).

## Proposed approach

Record a job for setup and publish the same way capture does, so every
owner task lands in the same list with the same summary and cost fields.
Decide whether a setup run should show its imported-memory count as its
summary.

## Acceptance criteria

- [ ] Finishing setup adds a "Set up" row to Recent runs.
- [ ] Approving or skipping every draft in a publish thread adds a "Publish" row.
- [ ] Rows carry the same date and status chip as capture rows.

## Notes

Screenshots `27-dogfood-today-after-setup.png` and `70-dogfood-relaunch.png`.

**Prioritization 2026-10-19:** promoted to `ready`. No open blockers, no commit on main implements it, and the acceptance criteria are concrete and checkable. Priority and effort unchanged.

**Prioritization (2026-11-12):** Priority P3 (was P2), effort S (was M).
Moved back from ready to in-review. Before it can be ready: The criteria
name a Recent runs section on Today, which no longer exists; runs show as
Activity in Settings. Rewrite against Settings > Activity and decide whether
setup and publish rows still matter now that the Inbox shows what ran.
