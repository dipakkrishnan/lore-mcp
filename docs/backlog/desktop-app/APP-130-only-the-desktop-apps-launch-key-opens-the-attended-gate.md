---
id: APP-130
title: Only the desktop app's launch key opens the attended gate
priority: P0
effort: S
component: desktop-app
status: in-review
related: [APP-006, APP-008, APP-035]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`_attended()` accepted a piped decision whenever `LORE_ATTENDED_SURFACE=desktop`
was set. The desktop agent's shell can set that itself, so a prompt injection in
text a connector imports could approve a publication of private memories.

## Proposed approach

Electron main makes a random key per launch, keeps it out of `process.env`, and
writes it to `~/Library/Application Support/Lore/attended`, outside every root
the agent sandbox may read or write. Only the CLI processes it spawns get the key
as `LORE_ATTENDED_KEY`. The CLI compares it to the file.

## Acceptance criteria

- [x] The old marker, a guessed key, or the right key on a TTY is refused
- [x] The real `decide()` from `state.cjs` still passes the gate
- [x] Under `bashSandboxPolicy` for capture, setup and deploy, the agent's shell
      can neither read nor write the key file

## Notes

The setup task may write `~/Library/LaunchAgents`, and a LaunchAgent runs
outside the sandbox. That is a separate escape from this item.
