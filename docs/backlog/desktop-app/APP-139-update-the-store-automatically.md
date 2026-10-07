---
id: APP-139
title: Update the store automatically instead of asking to Push or Redeploy
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-136, APP-137, MON-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

"Push" and "Redeploy" are two technical verbs for one idea: make my store
match what I approved. One For Sale screen can show both up to four times
(banner, store bar, section header, stale-price line), and Today repeats
them (`store--store-unpushed.png`).

## Proposed approach

After approve, take down, price or free-copies change, the app updates the
store on its own (push, or redeploy when baked-in values changed), showing a
quiet "Updating your store… ✓" and a plain retry on failure. If an update
can't be automatic, fall back to one "Publish changes (N)" button with a
popover listing exactly what changes. Inspiration: Stripe's unpublished
changes bar, Framer/Webflow Publish.

## Acceptance criteria

- [ ] No seller-facing "Push" or "Redeploy" wording remains.
- [ ] Each owner change reaches the store without a separate click, or via one Publish changes button.
- [ ] A failed update says so plainly with one retry.
