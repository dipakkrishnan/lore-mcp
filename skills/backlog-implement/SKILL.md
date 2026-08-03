---
name: backlog-implement
description: Take a ready backlog item under docs/backlog/ to completed. Use when the user says "work the backlog", "implement the next backlog item", "pick up CAP-001", or names a specific backlog id to implement.
---

# Backlog: implementation

Read `docs/backlog/agents/AGENTS.md` for the shared rules, then
`docs/backlog/agents/implementation.md` and follow it exactly. If
the request names a specific item id, implement that one (after confirming
its blockers are actually completed); otherwise pick the highest-priority
unblocked `ready` item per the playbook.

Do not regenerate `docs/backlog/INDEX.md` yourself — end by suggesting the
`backlog-audit` skill (or running the `audit` playbook) to reflect the new
status.
