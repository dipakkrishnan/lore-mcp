---
id: XC-070
title: A yourlore.dev home page in the app's look that shows the product
priority: P1
effort: S
component: cross-cutting
status: completed
related: [APP-040, XC-040, APP-222]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-19
---

## Problem

yourlore.dev is a dark page with a logo, two sentences and a button. It looks
nothing like the app people download, never shows the product, says nothing
about where memories come from or that agents pay, and its "Download for
macOS" button gives Intel Macs an app that won't open.

## Proposed approach

Rebuild the home page in the app's own colours and type, with a dark variant
matching the marketplace page: a headline about everything you learn, the
sources Lore gathers from, the Today screen drawn as a window, three short
beats (bring it in, it stays on your Mac, agents pay), and a download button
that says it needs Apple silicon and macOS 13.

## Acceptance criteria

- [x] The page matches the app's palette and type, light and dark.
- [x] It names agents, notes, meetings and reading as sources, not one agent.
- [x] The download link is unchanged (releases/latest) and says Apple silicon.
- [x] No horizontal scroll at phone width.

## Notes

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in 021806f, df5de05. Closed out in the review-queue pass.
