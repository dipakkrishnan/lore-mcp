---
id: APP-238
title: Today says Good evening after midnight, not Good morning
priority: P3
effort: XS
component: desktop-app
status: obsolete
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-10-22
updated: 2026-11-13
---

## Problem

Today's greeting counted every hour before noon as morning, so at 12:15 AM it said "Good morning."

## Approach

Hours before 5 AM count as evening.

## Acceptance

- Midnight to 4:59 AM: "Good evening." 5 AM to noon: "Good morning." The afternoon and evening hours are unchanged.

## Notes

**Prioritization (2026-11-12):** Priority P3, effort XS (was S). Stays in-
review. Before it can be ready: Close as completed or obsolete.
Prioritization flag (not acted on): done (#536), then obsolete with APP-283.

**Close-out (2026-11-13):** obsolete. The fix did ship (d5119e6e, #536), but the
greeting it fixed no longer exists. APP-283 (87a79efb, #641) replaced Today
with the Inbox and removed the greeting. Neither "Good morning" nor "Good
evening" appears anywhere in `app/desktop/src` (`git log -S"Good evening"`
ends at 87a79efb). Nothing is left to check.
