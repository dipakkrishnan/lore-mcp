---
id: APP-028
title: Blueprint card fields grow with their content
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-020, APP-022, APP-016]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

The blueprint proposal card renders Topics, In depth, Lightly, and Voice
as single-line text inputs; real values overflow and the owner has to
scroll sideways inside the field to read their own blueprint (Dipak,
2026-08-23 dogfood). The card content also shrinks to content width and
centers instead of filling the card — the third occurrence of `.request`
inheriting `.lead { align-items: center }` (fieldsets and the stopped
card hit it before).

## Proposed approach

Swap the list and voice inputs for auto-sizing textareas reusing the
composer's autosize pattern (height from scrollHeight, capped); keep
Name as an input. Fix the centering at the source this time: `.request
{ align-items: stretch }` (title, hint, fields, and actions all
full-width, text-align left) instead of per-child stretch patches.

## Acceptance criteria

- [x] Topics/In depth/Lightly/Voice show their full value, wrapping and
      growing to fit; no horizontal scrolling within a field.
- [x] The card's content fills the card width; no centered shrink-wrap.
- [x] Desktop typecheck and tests pass.

## Notes

Implemented in the batch PR: list and voice fields are auto-sizing textareas (shared fit helper with the composer); `.card.request { align-items: stretch }` kills the centering class. Also fixed here: Organized-by gains a 'persona default' option that omits organizing_axis instead of silently submitting 'chronological'.
