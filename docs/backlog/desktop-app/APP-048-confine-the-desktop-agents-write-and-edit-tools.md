---
id: APP-048
title: Confine the desktop agent's write and edit tools to the Lore home
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-008, APP-035, APP-047]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-13
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

- [x] A desktop write or edit outside `$LORE_HOME` and the task's owned
      directories fails with a clear error and changes nothing.
- [x] Writes inside `$LORE_HOME` still work for capture, publish, setup, and
      deploy.
- [x] One test covers the refusal and the allowed path.

## Notes

Found while verifying APP-047. Not a launch blocker for the trusted alpha,
but it belongs with APP-035 in the pre-public-beta hardening set.

**2026-09-13 implementation.** `createSandboxedWriteOperations`/
`createSandboxedEditOperations` in `app/desktop/src/agent.mjs` mirror
`createSandboxedBashOperations`: each resolves the target path's nearest
existing ancestor to its real path (the same symlink-escape defense
`bashSandboxPolicy` already applies to `loreHome` itself) and checks it
against `bashSandboxPolicy(...).filesystem.allowWrite` for the active task,
throwing before touching the filesystem if it's outside. Wired into
`#newSession`'s `customTools` the same way `bash` already overrides its
built-in tool by name. `read` was left unconfined, per the proposed
approach — only `write`/`edit` had the gap. One test
("desktop write and edit are confined to Lore, like Bash already is") covers
both the refusal (a symlink-escaped path, mirroring the existing Bash
sandbox test) and the allowed path (a new file under a not-yet-created
directory inside Lore's home).
