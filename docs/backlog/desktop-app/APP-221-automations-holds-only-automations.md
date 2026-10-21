---
id: APP-221
title: Automations holds only automations, and a calmer composer focus
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-219, APP-218]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-19
---

## Problem

Automations ended with "Recent runs", a log of store updates, deploys and agent
tasks. None of those are automations, so it read as if they were. The composer
also drew a hard 2px ring a gap outside its pill whenever it had focus, which
looked like a second outline around it.

## Fix

The log moves to the end of Settings as "Activity". Automations shows only
automations. The composer's focus is a soft accent halo and border, still plain
to see.

## Notes

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in 4af3d1b. Closed out in the review-queue pass.
