---
id: APP-260
title: Make the sidebar resizable by dragging its edge
priority: P2
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

The sidebar is fixed at 224px (styles.css:162). macOS users expect to drag its edge. Feedback #1: "draggable lines on the side should be functional."

## Proposed approach

Add a 6px handle on the aside's right edge with `cursor: col-resize`, using pointer capture to set `--aside-width` clamped to 180–320px. Double-click resets. Remember the width in localStorage with try/catch.

## Acceptance criteria

- [ ] Dragging resizes the sidebar smoothly and the main column reflows
- [ ] Width survives relaunch; double-click restores 224
- [ ] The handle is not a window-drag region; nothing overflows at the 760px window minimum

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
