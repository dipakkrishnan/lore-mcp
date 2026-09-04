---
id: APP-074
title: Simplify the shape card
priority: P3
effort: S
component: desktop-app
status: obsolete
related: [APP-052, APP-022]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

The blueprint-review card shows name, persona, organizing axis, topics, in
depth, lightly and voice as seven editable fields at once. The owner's read on
first contact: the shape makes sense, but "in depth / lightly" is a
distinction they would not have asked for, and the card is more form than
proposal (dogfood 2026-09-04).

## Proposed approach

Unclear — needs a product pass. Candidates: fold in depth / lightly into the
topics list as a per-topic weight, or drop them from the card and keep them
in the blueprint file; show the summary sentence and name first with the rest
behind "Adjust".

## Acceptance criteria

- [ ] A first-time owner can accept or adjust the shape from a card with at
      most four visible controls.

## Notes
Folded into APP-052 on 2026-09-04: same card, same complaint; one item is enough.
