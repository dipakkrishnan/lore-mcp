---
id: APP-256
title: Introduce a six-step type scale and one rule for serif vs sans
priority: P1
effort: M
component: desktop-app
status: ideation
related: [APP-255, APP-258, APP-261]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

styles.css has 17 font sizes, 12 line-heights and 21 border radii. Row titles default to serif (`.t b`, :404) and are switched back to sans case by case, so cards on Today alternate serif 19, sans 14/600 and sans 15/600. Feedback: "inconsistent fonts."

## Proposed approach

Add `--text-xs/sm/base/md/lg/xl/display` (12/13/14/16/18/22/28) and three line-height tokens. Map every declaration to them. Serif only for the owner's content (h1, memory and piece titles, memory sheet title and description); sans for everything Lore says (cards, steps, questions, automations, palette input). Fold radii into 6/8/12/16/pill.

## Acceptance criteria

- [ ] `grep -o 'font-size: [0-9.]*px' styles.css | sort -u` returns only token definitions (plus the 40px hero and the 30px code)
- [ ] All Today card titles share one family, size and weight
- [ ] Before/after screenshots of Today, Inventory, Automations, memory sheet and palette in light and dark
- [ ] Walks green

## Notes

Mechanical. Do it in one PR so nothing ends up half-migrated.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
