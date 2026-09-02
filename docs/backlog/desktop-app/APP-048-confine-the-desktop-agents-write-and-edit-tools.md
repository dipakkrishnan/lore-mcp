---
id: APP-048
title: Confine the desktop agent's write and edit tools to the Lore home
priority: P1
effort: S
component: desktop-app
status: ready
related: [APP-008, APP-035, APP-047]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-01
---

## Problem

APP-008 confines the desktop agent's Bash to `$LORE_HOME` with the macOS
sandbox, but pi's `write` and `edit` tools run inside the Electron process and
are not confined at all. During a 2026-09-01 headless dogfood on a throwaway
Lore home, the publish agent hit a stale CLI without `publication draft`,
fell back to the `write` tool, and wrote `publish-candidates.json` into the
owner's real `~/.lore` rather than the test home. Any confused or injected
agent can write anywhere the owner can.

## Proposed approach

Give the desktop agent write and edit tools whose operations resolve and
check the target path against the same allow list `bashSandboxPolicy`
produces for the task, refusing anything outside it, and keep read
unconfined only for the paths that policy already allows. pi's tool factories
take an operations object, so this is the same shape as the sandboxed Bash
operations rather than a new mechanism.

## Acceptance criteria

- [ ] A desktop write or edit outside `$LORE_HOME` and the task's owned
      directories fails with a clear error and changes nothing.
- [ ] Writes inside `$LORE_HOME` still work for capture, publish, setup, and
      deploy.
- [ ] One test covers the refusal and the allowed path.

## Notes

Found while verifying APP-047. Not a launch blocker for the trusted alpha,
but it belongs with APP-035 in the pre-public-beta hardening set.
