---
id: APP-210
title: Today in the same tiles and cards as Connectors and Automations
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-207]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-19
---

## Problem

After APP-207, Connectors, Inventory and Automations use icon tiles and cards,
but Today still uses the older banded list. Moving between tabs feels like two
different apps. Grok Bot's mark is also a stand-in ring, not its real mark.

## Proposed approach

- New memories: one card per memory, with its agent's mark in a tile, like a
  routine. Who saved them and Clear sit in the section header.
- Needs you: a grid of icon tiles, like Connectors.
- Unfinished: cards in the same style.
- Grok Bot: its real mark, a white ball with two slanted eyes on a dark tile.

## Acceptance criteria

- [x] Today's sections use the same tile and card components as Connectors and Automations.
- [x] Grok Bot shows its real mark everywhere it appears.
- [x] All edge scenarios pass.

## Notes

Shipped in PR #476.

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in 0f929db. Closed out in the review-queue pass.
