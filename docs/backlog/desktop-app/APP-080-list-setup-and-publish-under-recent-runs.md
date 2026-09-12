---
id: APP-080
title: List setup and publish under Recent runs
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-007]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
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
