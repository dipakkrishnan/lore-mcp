---
id: APP-039
title: agent:status IPC handler is missing, logged as an error on every launch
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-038]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-01
---

## Problem

Every launch of the app (dev `npm start` and the packaged `Lore.app`, both via
`npm run dogfood:new`) logs `Error occurred in handler for 'agent:status':
Error: No handler registered for 'agent:status'` from Electron's Session
event emitter, immediately on startup — before sign-in, before `uv`
provisioning, before any owner interaction. Something in the renderer or a
loaded session is sending or listening for an `agent:status` IPC event that
main never registers a handler for. It is unclear whether this is purely
console noise or an owner-visible symptom (a stuck/missing status
indicator), since it fires unconditionally rather than in response to a
specific action.

## Proposed approach

Unclear — needs investigation. Find where `'agent:status'` is emitted/listened
for (likely `ipcMain`/`ipcRenderer` or a `Session` handle event) and either
register the missing handler in the main process or remove the dead
listener/emitter if the feature it belonged to was already removed.

## Acceptance criteria

- [ ] Root cause identified: what emits/expects `agent:status`, and why no
      handler is registered.
- [ ] A clean `npm start` and a clean `npm run dogfood:new` launch produce no
      `No handler registered for 'agent:status'` error in the log.
- [ ] If the underlying feature (e.g. a status indicator) was meant to work,
      confirm it now does; if it was dead code, confirm removal leaves no
      other loose ends.

## Notes

Observed in the full log of a fresh `npm run dogfood:new` run (2026-09-01),
immediately after the "Fresh-user sandbox" banner and before the `uv`
provisioning output:

```
Error occurred in handler for 'agent:status': Error: No handler registered for 'agent:status'
    at Session.<anonymous> (node:electron/js2c/browser_init:2:118484)
    at Session.emit (node:events:509:28)
```

Also reproduced earlier the same session via plain `npm start` in dev mode.
Filed alongside APP-038 (a different, unrelated symptom from the same
dogfood run) — keep them separate since the root causes are unlikely to be
related (one is Keychain/signing, this one is an IPC wiring gap).
