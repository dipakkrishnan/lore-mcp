---
name: backlog-ideate
description: Turn a raw idea, TODO, or complaint into a well-formed backlog item under docs/backlog/. Use when the user says "add this to the backlog", "file a backlog item for X", "capture this as a backlog item", or when scanning code/history for un-tracked work worth recording.
---

# Backlog: ideation

Read `docs/backlog/agents/AGENTS.md` for the shared rules, then
`docs/backlog/agents/ideation.md` and follow it exactly against the idea in the
request or surrounding conversation.

Do not regenerate `docs/backlog/INDEX.md` yourself. If you actually created
a new item this run, invoke the `backlog-audit` skill (via the Skill tool)
before finishing so `INDEX.md` reflects it — don't just suggest it to the
user. If the idea turned out to be a duplicate and you only folded notes
into an existing item, there's no new item for audit to fold in, so skip
the call.
