---
id: APP-255
title: Show automations as cards with a visible on/off switch
priority: P1
effort: S
component: desktop-app
status: ideation
related: [APP-256, APP-258]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Each automation row starts with an empty ring (`state-ring`, renderer.js:4073), and users read it as an unchecked to-do. The real switch is hidden until hover (styles.css:859). First-user feedback (Oct 27): "bullets are misleading, I'd like to see a card view."

## Proposed approach

Drop the state-ring. Prepend the same `markTile` tile Today's cards use. Render the rows with the existing `.routines .row.routine` card style (border, `--radius-lg`, surface, hover shadow). Keep the switch visible at rest; only Run now and Remove fade in on hover.

## Acceptance criteria

- [ ] No ring or bullet before any automation; each row is a card with a mark tile
- [ ] The on/off switch is visible without hovering, and paused cards grey their mark as Today's do
- [ ] Clicking a card still opens it; the switch and Run now still work without opening it
- [ ] Light and dark walks updated and green

## Notes

Reuses `.routines .row.routine` and `markTile`; no new component.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
