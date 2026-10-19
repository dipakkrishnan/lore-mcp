---
id: APP-220
title: Marks that match the app
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-213, APP-218]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-18
---

## Problem

Where Lore wrote a memory itself, its tile drew Lore's mark in the tile's muted
grey, a muddy grey-green blob unlike the green mark in the sidebar. Grok Bot's
mark is already a whole dark app tile, so framing it in another bordered tile
read as a box in a box.

## Fix

Lore's mark fills its tile in Lore's own colours, as in the sidebar. Grok Bot's
mark fills its tile with no second frame, on memory rows and Connectors tiles.
