---
id: APP-259
title: Cut perceived latency at startup, in Cmd-K and when opening a memory
priority: P2
effort: M
component: desktop-app
status: ideation
related: [APP-257, APP-262]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Startup waits on `firstRun.read()` (up to 5 s) before the snapshot load even starts (renderer.js:5732). Then 9 IPCs, about 5 of them CLI processes, must all finish before anything renders, behind a bare "Loading…". Cmd-K spawns the CLI per query, and opening a result spawns it again before anything appears.

## Proposed approach

Run `load()` alongside `firstRun.read()` and gate only Today's render. Render when `snapshot` lands and fill the rest progressively. Show skeleton cards (`.card` + `.shimmer`) instead of "Loading…". In the palette, filter titles from the snapshot instantly, then merge content hits. Open the memory sheet immediately with title and shimmer, reusing the `peeked` cache.

## Acceptance criteria

- [ ] Time from launch to Today cards measured before and after on a seeded sandbox home; the after number is lower
- [ ] Palette shows title matches within one frame of typing
- [ ] The memory sheet frame appears on click, before content loads
- [ ] Walks green

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
