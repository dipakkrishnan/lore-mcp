---
id: APP-282
title: Make Inventory, Connectors and Automations one-line rows
priority: P1
effort: L
component: desktop-app
status: ideation
related: [APP-281, APP-255]
blockers: []
dependencies: [APP-281]
github_issue: null
created: 2026-11-02
updated: 2026-11-02
---

## Problem

After APP-281 the lists still use the old patterns: Inventory groups are boxed with letter avatars, two-line rows,
"No views yet" on every row, a column of Take down buttons and segmented pill filters whose counts don't add up;
Connectors are three-column tiles; Automations rows run to three lines.

## Proposed approach

Audit step 4 and principles §4: flat group header rows (label + count), one-line rows (status glyph · title ·
source icon · date · price), actions on hover or in the row menu, text tabs for filters, one status per memory.

## Acceptance criteria

- [ ] Each list is one-line rows on hairlines; filter counts add up to All.
- [ ] Connectors and Automations read as Linear's Integrations list.
