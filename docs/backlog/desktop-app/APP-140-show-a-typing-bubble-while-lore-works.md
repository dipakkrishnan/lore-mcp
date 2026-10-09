---
id: APP-140
title: Show a typing bubble while Lore works
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-137]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

While a turn was open, the thread ended in a plain muted line such as
"Setting up your store…", which read like a stuck message. A tool starting
also replaced whatever Lore had just been saying with that line.

## Proposed approach

End an open turn with a Messages-style typing bubble, labelled with what
Lore is doing. Tool starts relabel the bubble (`status: true` on the live
event) instead of replacing streamed text. The bubble goes when the turn
closes or Lore asks the owner something.

## Acceptance criteria

- [x] An open turn ends in a three-dot bubble with a short label.
- [x] A tool's status relabels the bubble; what Lore said stays readable.
- [x] The bubble goes when the turn closes; reduced motion stops the dots.
