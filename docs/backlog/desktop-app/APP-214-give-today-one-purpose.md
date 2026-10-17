---
id: APP-214
title: Give Today one purpose: what came in, and the one thing to do next
priority: P0
effort: M
component: desktop-app
status: ready
related: [APP-210, APP-212, APP-215]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-17
---

## Problem

Today's "Needs you" has no limit on cards, so they compete, and one of them
("Connect your agents: Let Lore read what Claude Code and Codex already
remember") means coding agents, not the personal agents Connectors leads
with. It stays after Grok Bot is connected. Today's purpose is unclear.

## Proposed approach

Today answers "what came in, and the one thing to do next", always in this
order:

1. Evening check-in, only when there is one.
2. New memories since the owner last looked, each with its source (APP-213).
3. One next-step card, chosen by stage: connect an agent → sell something
   (draft a piece from memories) → approve drafts → update the store. Only
   the first stage that applies shows.
4. Unfinished work.
5. The stats line.

Stages are checked in this order and exactly one shows: store failed or
unreachable → fix it; changes waiting to go live (additions or removals) →
update the store; drafts waiting → approve them; memories but nothing drafted
→ sell something; no agent and no app connected → connect your agent;
otherwise nothing. Approvals and earnings keep their own sections below New
memories; Recent runs moves to Automations.

The coding-agent card leaves Today; those apps live in Connectors.

## Acceptance criteria

- [ ] At most one next-step card on Today, picked by the first stage that applies.
- [ ] No Today card mentions Claude Code or Codex.
- [ ] With an agent connected, Today never asks to connect an agent.
- [ ] Edge checks cover each stage.
