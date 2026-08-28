---
id: ONB-001
title: Capture and inject context via agent session hooks
priority: P3
effort: L
component: onboarding
status: in-review
related: [STO-001, XC-001, XC-002]
blockers: [XC-002]
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-26
updated: 2026-08-26
---

## Problem

Classification happens in a separate `lore review` session, away from where the
context was actually created. There is no way to capture durable context at the
moment a session produces it, and no way for Lore to make itself useful *inside*
a session. Issue #6's Proposals 2 and 4 ask for in-session control; the current
model can't provide it.

## Status: deferred

Explicitly deferred by the "Private by Default, Publish by Intent" doc, which
lists "No GUI, hooks, raw transcript capture, recurrence digest, or automated
publication suggestions yet. Add those only after intent-driven publishing proves
useful." Kept at `ideation`/P3 and re-pointed to block on XC-002 (the publish
flow) rather than STO-001: hooks feed captures, and captures are themselves the
deferred half of the model. Do not pick this up until intent-driven publishing
has shipped and earned it.

## Proposed approach

Ship a Claude Code plugin (`hooks/hooks.json`) rather than editing the user's
`~/.claude/settings.json`, so Lore never mutates a config it doesn't own and
uninstall is clean. Use a `SessionEnd` hook to distill the session into candidate
claims and stage them (into STO-001's `captures` table). To respect the README's
"never reads transcripts" stance, use a `type: "prompt"` hook that produces a
summary — raw transcript text is never stored or indexed. Separately, a
`SessionStart` hook can return `additionalContext` to inject the owner's relevant
lore into new sessions, which also creates a natural, well-timed moment to ask for
a disclosure decision (right after a memory proved useful).

Codex's hook surface is thinner than Claude Code's; treat Claude-first as viable
and Codex parity as a separate question.

## Acceptance criteria

- [ ] Installing/uninstalling the plugin adds/removes the integration without
      editing files Lore doesn't own.
- [ ] `SessionEnd` capture never stores or indexes raw transcript text.
- [ ] Capture failure is silent and non-blocking to the user's agent session
      (`async`).
- [ ] Capture writes to the captures tier only, never to publications or private
      memories directly.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6 (Proposals 2
and 4). Blocked by STO-001 because it needs the captures tier to write into.
Confirmed against the Claude Code hooks reference: `async` command hooks,
plugin-scoped `hooks/hooks.json`, and `SessionStart` `additionalContext` all
exist. Trap to avoid: do not add a `capture` tool to `lore serve` — that is the
public paid MCP surface intended to sit behind the gateway.

**Prioritization pass 2026-08-26:** the formal blocker (`XC-002`) is now
`completed`, but not promoting — the "Status: deferred" section's bar is
qualitative ("do not pick this up until intent-driven publishing has shipped
and earned it"), not just XC-002 shipping. Flagging for reconsideration
rather than deciding it here: worth a fresh look at whether publishing has
"earned" this yet.
