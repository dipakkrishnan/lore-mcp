---
id: APP-081
title: Stop calling a missing store "Setting up"
priority: P3
effort: XS
component: desktop-app
status: in-review
related: [APP-049]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

The account chip in the sidebar reads "Claude · Setting up" for the whole
life of an owner who has never opened a store. The renderer maps the node
state "Not set up" to "Setting up" on purpose (`renderer.js:717`), but nothing
is in progress, and the chip sits next to a Today screen that says "Store not
set up". "Setting up" promises a state change that never comes (dogfood
2026-09-05, fresh sandbox from sign-in through publish).

## Proposed approach

Show only the provider when there is no store ("Claude"), and add the store
word once it exists ("Claude · Live", "Claude · Offline"). If the chip is
meant to show runtime provisioning, drive it from the provision progress
event instead and let it clear when provisioning finishes.

## Acceptance criteria

- [ ] With no store, the chip never says "Setting up" after provisioning has finished.
- [ ] With a live store the chip still says "Live".

## Notes

Every dogfood screenshot from the 2026-09-05 pass shows the chip.
