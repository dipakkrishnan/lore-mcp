---
id: AUT-012
title: Judge an agent's saves, and write no memory beside them
priority: P1
effort: S
component: automation
status: in-review
related: [AUT-005, APP-233, APP-235, APP-263]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-29
updated: 2026-10-29
---

## Problem

When a personal agent (Grok Bot, Claude, ChatGPT, Instinct) saved to Lore, its saves landed as memories and
appeared on Today. Then Lore ran its usual reading over them, with the same prompt it uses for raw app imports
("turn what earns a place into memories"), and wrote a topic memory of its own on top. Every agent save came
with a duplicate. Found while dogfooding on Oct 29.

## Proposed approach

An agent's saves are memories already, so the reading after them only judges them:
- It is handed the saves by id.
- It gets no write or edit tools.
- It returns, per id, whether each save looks worth selling and why.

Anything it writes anyway is ignored. Its verdicts are recorded (`memory judge`) and land on the Today card the
saves are already on. No new memory, no extra notification, and no change to the badge count.

## Acceptance criteria

- [x] An agent's save produces no Lore-written memory beside it (checked by the agents walk: the library's memory ids are unchanged by the reading).
- [x] What Lore judged worth selling shows on the agent's own saves: the Today card reads "N new memories · 1 worth selling".
- [x] A reading of an app's raw items still writes topic memories as before.
- [x] Unit test: the judge prompt says to write nothing and lists the ids, and verdicts for ids the reading wasn't given are dropped.
