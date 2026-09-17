---
id: CAP-006
title: Import ChatGPT and Claude.ai conversation exports
priority: P1
effort: M
component: capture
status: in-review
related: [STO-003, CAP-001, ONB-004, APP-120]
blockers: []
dependencies: ["STO-003 for the source kind and state"]
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

Setup reads Claude Code and Codex history, which a non-developer owner does
not have. What they do have is months of ChatGPT or Claude.ai
conversations: the questions they asked about their job, drafts, decisions
worked through, all first-person and dated. Both products export this as a
zip on request, and Lore cannot read it. This is the nearest thing to agent
history for the owner `ONB-004` describes.

## Proposed approach

The `export` kind from `STO-003`, fed by the zip drop rail capture already
has. Recognise the two layouts by their `conversations.json`:

- ChatGPT: an array of conversations, each with `title`, timestamps, and a
  `mapping` of message nodes. The mapping is a tree; walk from
  `current_node` back through `parent` to the root and keep only that path,
  so abandoned edits and regenerations are never imported as if said.
- Claude.ai: an array with `name`, timestamps, and a flat `chat_messages`
  list where each entry has `sender` ("human" or "assistant"), `text`, and
  `created_at`.

Keep the human turns longer than a sentence as the owner's words, with the
assistant reply attached as context; one memory per conversation by default,
titled from the conversation, dated from its first message. Parse and
cluster entirely in Python and feed the correction flow in pages of
candidates, so a large export never enters the agent's context whole.

## Acceptance criteria

- [ ] Dropping a ChatGPT export imports one private memory per conversation
      on the kept path only; a regenerated branch never appears.
- [ ] Dropping a Claude.ai export does the same from the flat list.
- [ ] An export with hundreds of conversations completes without the agent
      reading the raw file; the correction flow shows candidates in pages.
- [ ] Dropping the same export twice adds nothing.

## Notes

Both exports are emailed as a link that expires after 24 hours; the connect
sheet should say where to click (ChatGPT: Settings, Data controls, Export;
Claude: Settings, Privacy, Export data). The research pass found Claude's
export omits Projects and Memory; confirm against a real export. Dipak's
gotcha, 2026-09-17: context thresholds. The design answer is that readers
chunk in Python and only proposals reach the agent (`STO-003` Notes).
