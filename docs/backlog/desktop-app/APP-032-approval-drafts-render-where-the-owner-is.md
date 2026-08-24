---
id: APP-032
title: Approval drafts render where the owner is
priority: P0
effort: S
component: desktop-app
status: ready
related: [APP-020, APP-023, APP-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

Publish drafted two candidates and said "ready for your approval below" —
but the owner was in the publish task's detail view, which renders an
empty content area (`renderToday` returns `[]` while a detail is open),
because the "Approve what to sell" section only exists on the Today
inbox. The drafts were real (`lore publication candidates` had 2); the
surface pointing at them wasn't drawn (Dipak, 2026-08-23). The task also
read "Done · Finished" while approvals were still pending.

## Proposed approach

Render the approvals section inside the publish task detail as the task's
current card, in addition to Today. While candidates exist, the publish
task presents as needs_you ("2 drafts to approve"), not done — same
presentation-only adjustment used for dead-run records. The model's
wording follows for free: "below" becomes true wherever the owner is.

## Acceptance criteria

- [ ] After a publish turn, the approval cards are visible without
      leaving the task detail; Today shows them too.
- [ ] A publish task with pending candidates lists as "Needs you · N
      drafts to approve"; approving or skipping the last one settles it
      to done.
- [ ] Desktop typecheck and tests pass.
