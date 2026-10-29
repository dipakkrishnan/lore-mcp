---
id: APP-261
title: Give the main pane depth with an inset panel and one elevation token
priority: P3
effort: S
component: desktop-app
status: ideation
related: [APP-256]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

The main pane is flat cream to the window edge, with flat cards. Feedback #6: "the bare state is very Claude; pull from Linear / Monday."

## Proposed approach

Inset `main` 8px from the window, with `--radius` corners, a 1px line and a hairline shadow, so the sidebar material frames it (Linear, Things). Replace the ad-hoc card shadows with `--elev-1/--elev-2` tokens. No new colours.

## Acceptance criteria

- [ ] Screenshot reviewed by Dipak in light and dark before merge
- [ ] Sticky header and scroll shadow still line up inside the panel
- [ ] Walks green

## Notes

Taste item: show it before building it.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
