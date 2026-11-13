---
id: APP-186
title: Show a new seller one next step on Today, not four orange rows
priority: P3
effort: S
component: desktop-app
status: in-review
related: [APP-109, APP-030]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-12
---

## Problem

On day one, Today shows four orange "Needs you" rows at once: Connect, Start,
Paste and Publish. "Sell something you wrote" and "Publish something" look
identical. A new seller can't tell which to do first, and the orange makes all
four look urgent.

## Proposed approach

Show one recommended next step in full and collapse the rest under "Other
ways to start". Merge the two selling rows. Keep orange for things that are
actually waiting on the seller.

## Acceptance criteria

- [ ] A fresh install shows one highlighted next step on Today
- [ ] No two rows on Today describe the same action

## Notes

Filed from the 2026-10-06 new-seller audit. Overlaps APP-137 (one next step
on Today, open PR #402); fold this into APP-137 if that lands first.

**Prioritization pass 2026-11-11:** Moved `ready` → `in-review`: APP-283 (#641) replaced Today with an Inbox, so the criteria name a page that no longer exists. Rewrite them against the Inbox, or mark this `obsolete` (it overlaps APP-137).

**Prioritization (2026-11-12):** Priority P3 (was P2). Stays in-review.
Before it can be ready: Rewrite against the Inbox's first-run state, or
close. Prioritization flag (not acted on): obsolete: Today was replaced by
the Inbox (APP-283, #641); overlaps APP-137.
