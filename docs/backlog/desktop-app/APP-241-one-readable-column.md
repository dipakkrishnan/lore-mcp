---
id: APP-241
title: Keep each page to one readable column on a wide window
priority: P3
effort: S
component: desktop-app
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-10-22
updated: 2026-10-22
---

## Problem

On a wide window, Today's rows, the capture bar and every other page stretched edge to edge. Each row had its title at the far left, its action at the far right and a long empty middle.

## Approach

The page keeps one 840px column, centered. The sticky header still spans the window so what scrolls under it stays covered.

## Acceptance

- At 2000px wide, Today's header, capture bar and rows share one centered 840px column.
- Narrow windows look as before. Views with their own narrower cap (thread, first run) keep it.
