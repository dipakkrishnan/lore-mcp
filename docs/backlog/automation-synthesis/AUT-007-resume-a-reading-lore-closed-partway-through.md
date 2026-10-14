---
id: AUT-007
title: Resume a reading that Lore was closed partway through
priority: P2
effort: S
component: automation-synthesis
status: ideation
related: [AUT-005, AUT-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-13
updated: 2026-10-13
---

## Problem

AUT-005 keeps waiting readings only in memory. If Lore quits during a reading
or before one starts, the imported items are never read through. The next Read
again adds nothing, because the items are already in the library, so nothing
triggers another reading.

## Proposed approach

Persist the queue of waiting readings (source, label, item, count) beside
`memories-ready.json`. Drop a reading from the file only after its
`memories_ready` handback, and start whatever is still waiting at the next
launch.

## Acceptance criteria

- [ ] A reading that was waiting or under way when Lore quit runs at the next
      launch.
- [ ] A reading that already handed back its memories never runs twice.

## Notes

Found while building AUT-005. The scheduled prompt now reads connected apps,
which covers owners with Claude Code or Codex, but no one else.
