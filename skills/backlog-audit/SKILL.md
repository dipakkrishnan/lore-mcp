---
name: backlog-audit
description: Validate every item under docs/backlog/ (unique ids, valid frontmatter, resolvable cross-references, no blocker cycles) and regenerate docs/backlog/INDEX.md from the item files. Use when the user says "audit the backlog", "regenerate the backlog index", "check the backlog for issues", or after any manual edit to a backlog item.
---

# Backlog: audit

Read `docs/backlog/agents/AGENTS.md` for the shared rules, then
`docs/backlog/agents/audit.md` and follow it exactly. `INDEX.md` is derived —
this is the only skill that should ever rewrite it.

Report hard errors (duplicate ids, broken cross-references, blocker cycles)
clearly and separately from routine notes (id gaps, stale in-progress items).
