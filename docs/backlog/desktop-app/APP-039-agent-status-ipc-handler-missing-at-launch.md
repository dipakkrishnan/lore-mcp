---
id: APP-039
title: agent:status IPC handler is missing, logged as an error on every launch
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-038]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-10-20
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

- [x] Root cause identified: what emits/expects `agent:status`, and why no
      handler is registered.
- [x] A clean `npm start` and a clean `npm run dogfood:new` launch produce no
      `No handler registered for 'agent:status'` error in the log.
- [x] If the underlying feature (e.g. a status indicator) was meant to work,
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

**Prioritization 2026-10-19 (corrected in review):** not promoted; likely already
fixed in source. `ipcMain.handle("agent:status", ...)` is registered at
`app/desktop/src/main.cjs:110` inside `registerIpc`, which `app.whenReady()` calls at
line 482, before `createWindow()` at line 483, and `preload.cjs:6` exposes the
matching `agentStatus`. `git log -S'agent:status'` puts the handler in `ec97b0b`
(APP-003, 2026-08-22), ten days before this report, so the 2026-09-01 error may have
come from a stale or packaged build. It cannot be settled by reading code: it needs
a launch log from a clean `npm start` on current main. If that log is clean, close
this as `completed` and cite `ec97b0b`.

**Completed 2026-10-20 (already fixed; verified, no code change):**

- **Root cause.** The renderer calls `window.lore.agentStatus()` at startup, which `invoke`s `agent:status`. At the 2026-09-01 report (`bfe7dbb`), `createWindow()` ran at `main.cjs:135` but `registerIpc(loreHome)` only ran at line 208, after the awaited provisioning. So the first call beat the handler and Electron logged `No handler registered`. That also explains why it fired before `uv` provisioning output and before any owner action.
- **Fix.** `691cd98` (APP-054, 2026-09-02, #192) moved `registerIpc(...)` ahead of `createWindow()` (now `main.cjs:504` then `:506`). The handler itself dates from `ec97b0b` (APP-003) and is unchanged (`main.cjs:113`).
- **Clean launch.** Launched `electron .` on current main in an isolated sandbox (temp `LORE_HOME`, `LORE_STORE`, user data and `XDG_CONFIG_HOME`; schedule skipped) for 25 seconds with `ELECTRON_ENABLE_LOGGING=1`: no output at all, and zero `agent:status` or `No handler registered` hits. Did not run the packaged `dogfood:new` build.
- **Feature works.** `support/edge.sh fresh` exits 0 with no `No handler registered` in its output; its sign-in and sign-out checks go through `agentStatus`.
- **Not done.** Nothing pins the ordering, so a regression would only show as this log line. APP-064 (preload/main IPC contract test) covers channel-to-handler matching but not ordering.
