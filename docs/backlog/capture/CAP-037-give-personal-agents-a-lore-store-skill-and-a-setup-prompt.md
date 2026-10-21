---
id: CAP-037
title: Give personal agents a lore-store skill and a setup prompt
priority: P0
effort: S
component: capture
status: completed
related: [XC-067, CAP-036, APP-207, CAP-001]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/467
created: 2026-10-16
updated: 2026-10-19
---

## Problem

A connected agent needs to know what is worth saving to Lore, when to save
it, and how to keep it current. Without that it either saves nothing or
saves chat noise. Owners need one block they can paste into Grok, Muse,
ChatGPT or Claude, whichever supports skills, instructions or memory.

## Proposed approach

`plugins/lore/skills/lore-store/SKILL.md` is the one source of truth. The
app's setup sheet and `lore agents connect` render its body as the paste
block. It tells the agent to:

- Save first-hand context: experience, lessons, preferences, facts about the
  owner's work and life that another agent couldn't find by searching. Skip
  passwords, other people's private details, and anything the owner asked to
  keep out.
- Use one stable `key` per topic and save again when the owner's context
  changes. This proactive updating is the point, not a log of chats.
- Say what it saved in one line, and offer, never assume: "Want me to save
  that to Lore?" the first time a topic comes up.
- Tell the owner that Lore keeps it private and nothing is sold without
  their approval in the Lore app.
- On a schedule, where the agent supports routines (Grok), sweep the week
  for anything new worth saving.

## Acceptance criteria

- [x] The skill passes `tests/test_skill_contract.py` (name, when-to-use description, host metadata).
- [x] `lore agents connect --json` returns the paste block built from the skill, with the agent's MCP URL and name filled in.
- [x] The block reads as plain language for a non-technical owner, and the instructions say nothing is sold without approval.

## Notes

- Muse may build its own client against an HTTP API and keep keys in its
  credential store. The block includes the URL and header in a form that
  works for that too.
- Built (Oct 16): `plugins/lore/skills/lore-store/` (SKILL.md and
  `agents/openai.yaml`). Its body has `{name}`, `{mcp_url}` and `{header}`,
  which `SetupPrompt` fills in for `lore agents connect` and `lore agents
  key`. The wheel carries the skill through the `lore/store_skill.md`
  symlink (package-data), so an installed CLI renders it without the
  repository. The desktop's skills folder stays free of symlinks.
- It is not installed for agents on this Mac: `install.sh` skips it, and
  the repo's `.claude`/`.agents` folders don't link it. Local agents write
  to Lore directly, and `lore-capture` covers "remember this". The contract
  test keeps the remote skill out of those places. The plugins still ship
  the whole skills folder, so its description applies only when the agent
  has Lore's `store` tool.

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in f8859fb (#472), 677f5df, 347769b. Closed out in the review-queue pass.
