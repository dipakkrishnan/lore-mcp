---
id: MON-012
title: Surface the real cause when a push/deploy npm or wrangler subprocess fails
priority: P3
effort: S
component: monetization
status: ready
related: [MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-10
updated: 2026-08-26
---

## Problem

When the `npm`/`wrangler` subprocess behind `lore push` or `lore node deploy`
fails, the CLI prints a fixed guess at the cause — e.g. `lore push`'s failure
message says "check `npx wrangler login` and that `lore-publications`
exists" regardless of what actually broke. In one observed case the real
cause was an unrelated, corrupted `NODE_OPTIONS` environment variable
(pointing at a preload file that no longer existed) that made every Node
subprocess fail before wrangler even ran; the printed guidance pointed at
login and D1 state, both fine, and the raw Node error (`MODULE_NOT_FOUND`)
was left buried above the fold rather than surfaced as the likely cause.

## Proposed approach

Unclear in detail. One shape: when the subprocess fails, prefer surfacing the
subprocess's own stderr/last-error-line over (or alongside) the fixed guess,
so a Node-level failure reads as a Node-level failure rather than being
silently reframed as a wrangler/login/D1 problem.

## Acceptance criteria

- [ ] A subprocess failure unrelated to login/D1 (e.g. a broken Node
      environment) is not misattributed to login/D1 in the printed message
- [ ] The underlying error is visible without needing `--verbose` or manual
      log digging

## Notes

Surfaced 2026-08-10: `lore push` failed with a `MODULE_NOT_FOUND` Node crash
followed by the fixed `deploy.py` guess ("check wrangler login... or that
lore-publications exists"). Both suggested causes were red herrings; the fix
was `env -u NODE_OPTIONS lore push`, unrelated to anything the message
suggested checking.

**Prioritization pass 2026-08-26:** No blockers, small effort, concrete shape and a real reproduction already on record. Promoted `in-review` → `ready`.
