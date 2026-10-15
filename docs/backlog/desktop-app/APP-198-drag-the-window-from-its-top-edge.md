---
id: APP-198
title: Drag the window from its top edge
priority: P2
effort: XS
component: desktop-app
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-10-11
updated: 2026-10-11
---

## Problem

The window hides its title bar, so it only moves from regions the CSS marks
draggable. Only the empty strip above the sidebar was: the band across the top
of the main pane looks like a title bar but did nothing, so moving Lore to
another monitor meant hunting for the one spot beside the traffic lights.

## Proposed approach

A fixed 28px drag strip across the window's top, over the header's empty top
padding, so nothing clickable sits under it.

## Acceptance criteria

- [x] The window drags from anywhere along its top edge
- [x] No button, link or field sits under the strip, scrolled or not (`edge.sh settings`)
