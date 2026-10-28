---
id: XC-090
title: Fill the activation funnel's missing steps (agent connected, drafted, any memory saved)
priority: P1
effort: S
component: cross-cutting
status: ideation
related: [APP-250, XC-085, XC-092, APP-058, XC-067, CAP-036]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Funnel steps with no event: welcome completed, an agent connected to Lore (Claude, Grok, ChatGPT,
Cursor writing to the inbox), and a piece drafted. `memory.saved` fires only on
`lore capture apply`, so memories saved by agents, the inbox, or synthesis are invisible. The CLI
reports version `0.1.0`, which reads like an app build in version breakdowns.

## Proposed approach

Add to the contract, each once per install:
- `welcome.completed`
- `agent.connected{agent: claude|grok|chatgpt|cursor|codex|other}`, fired on the first inbox write
  per client
- `piece.drafted`

Record `memory.saved` on every save path. Add a relay-checked `surface` envelope field
(`app` / `cli`) next to `version`. Update PRIVACY.md's examples if needed.

## Acceptance criteria

- [ ] A fresh-home walk through first run → connect agent → save → draft → approve logs each
      event exactly once.
- [ ] `surface` is present on every event and validated by the relay.
- [ ] No counts, names, or content in any property.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
