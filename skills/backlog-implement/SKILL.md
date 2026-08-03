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

Do not regenerate `docs/backlog/INDEX.md` yourself. If you actually
completed an item this run, invoke the `backlog-audit` skill (via the Skill
tool) before finishing so `INDEX.md` reflects the new status — don't just
suggest it to the user. If you stopped without completing anything (no
unblocked `ready` item found, or you flagged under-scoping and bailed),
there's nothing new for audit to reflect, so skip the call.
