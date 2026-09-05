---
id: APP-085
title: Surface a readable error when a CLI read fails at launch
priority: P2
effort: S
component: desktop-app
status: in-review
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

On launch of the owner's real Lore (2026-09-05 14:56), the main process
logged `Error occurred in handler for 'store:sales': Error: }`. The CLI
wrapper (`state.cjs:33`) reports only the last line of stderr, which here was
a closing brace, so the log says nothing about what failed. The same command
succeeds when run by hand a few minutes later, so it looks like a race at
startup (runtime provisioning or two instances starting at once), but the
message gives no way to tell. The For Sale view loaded normally afterwards.

## Proposed approach

Keep the full stderr in the thrown error's cause and log it, while still
showing the owner the last meaningful line. Delay reads that hit the CLI
until provisioning reports the binary is present.

## Acceptance criteria

- [ ] A CLI failure logs the complete stderr, not only its last line.
- [ ] No `store:sales` error is logged on a normal launch of a configured Lore.

## Notes

Reproduction attempts: `runtime/bin/lore node sales --json` against `~/.lore`
returns `[]` with exit 0. Log kept in the 2026-09-05 session evidence
(`logs/current.log`).
