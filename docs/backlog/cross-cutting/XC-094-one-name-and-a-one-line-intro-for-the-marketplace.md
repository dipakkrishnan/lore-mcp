---
id: XC-094
title: One name and a one-line intro for the marketplace
priority: P2
effort: XS
component: cross-cutting
status: ideation
related: [XC-093, XC-074]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

The same place is called "Marketplace" (home nav), "Markets" (its own h1 and nav) and "Lore
Marketplace" (piece pages). /marketplace has no sentence telling a person what's there, the
samples are hidden one level down, and the home footer's "For agents" link opens raw JSON.

## Proposed approach

Call it Marketplace everywhere. Add an intro line, show the first line of each sample on overview
rows, put the outsider-friendly markets first, move "For agents" below "Sell what you know", and
replace the footer JSON link with a short "For agent builders" section.

## Acceptance criteria

- [ ] One name across home, marketplace and piece pages.
- [ ] /marketplace explains itself in one sentence above the fold.
- [ ] Overview rows show a sample line where one exists.
- [ ] No human-facing link opens raw JSON.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
