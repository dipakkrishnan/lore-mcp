---
id: APP-015
title: Show signs of life while Lore works, and lay out questions as rows
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-003, APP-009, APP-014]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

While a turn runs the only feedback was a 12px pulsing pill below the
composer, so a thirty-second read-and-draft felt like "is this thing on?".
pi streams text deltas and tool lifecycle events the whole time; the app
discarded them. Separately, question options rendered as shrink-to-fit
inline chips with the description appended after a dash, so long labels
wrapped mid-phrase and each option had a different width.

## Proposed approach

Forward pi's `message_update` text deltas and `tool_execution_start` as a
`live` event; the renderer shows one live line at the bottom of the log with
a pulsing mark — the model's text as it streams, or a plain phrase for tool
work ("Reading…", "Looking through your Lore…") that never names a tool.
The live line is replaced when the turn's message lands and cleared when
work ends. Options become full-width rows: radio, label, description on its
own line.

## Acceptance criteria

- [x] During a turn the log shows streamed text or a working phrase, updated
      continuously, and never a tool name.
- [x] The live line disappears when the final message arrives or the turn
      ends.
- [x] Question options are equal-width rows with the description under the
      label; no " — " joiner.
- [x] Desktop typecheck and tests pass; the card was checked with
      `window.__lore.preview`.

## Notes

Streamed text is the assistant's visible text only; thinking deltas are
ignored on purpose. The phrase for bash is deliberately vague: every bash
call in the desktop policy is a `lore` read or an owner-approved write.
