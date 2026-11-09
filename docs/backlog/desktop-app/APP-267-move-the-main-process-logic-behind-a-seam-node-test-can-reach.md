---
id: APP-267
title: Move the main-process logic behind a seam node:test can reach
priority: P1
effort: M
component: desktop-app
status: completed
related: [APP-062, APP-064, APP-269, APP-270]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-04
---

## Problem

`app/desktop/src/main.cjs` (828 lines) cannot be required outside Electron:
`require("electron")` is the binary's path string in plain node, and module
load calls `app.setPath`, `requestSingleInstanceLock`, `getVersion`,
`app.getPath` and `app.whenReady()`. About 300 of its lines are logic with
no unit test: `registerIpc` (96 handlers, lines 102-397), `queueReadings`,
`showSaved` and `AFTER_RUN` (401-486), the `store:online` message routing
(358-377), the `routines:run` notify rule (311-323), `watchSales` (599-640),
and the `LoreAgent.create` callbacks `proposeMemories`, `checkedIn`,
`memoriesReady` (676-791). Today those rules are proven only by walks:
`checkin`, `quiet`, `schedule`, `reading`, `sales` and `provision` exist
largely to drive them through a live window. `test/ipc-contract.test.cjs`
reads main.cjs as text for the same reason.

## Proposed approach

Follow the pattern main.cjs already uses for `Updates({ app, autoUpdater,
dialog, shell })` (tested at `test/app.test.cjs`), `Appearance(nativeTheme)`
and APP-062's owner gate (`test/owner.test.cjs`): move `registerIpc`,
`AFTER_RUN`, `queueReadings`, `showSaved`, `watchSales` and the agent
callbacks into `src/ipc.cjs`, exporting a factory that takes `{ ipcMain,
shell, clipboard, dialog, notify, getWindow, getAgent, paths, emit }`. main.cjs
builds the real Electron bundle and calls it. Make `runtime.cjs` read
`app.isPackaged` lazily so it, too, loads in node. Point the regex scan in
`ipc-contract.test.cjs` at the new file. Then write `test/unit/ipc.test.cjs`
with a fake ipcMain that records handlers and a fake notify, covering:
`store:online` routing; the `routines:run` notify rule; `AFTER_RUN.checkin`
and `.read` (notification, dock badge, Today card, queued readings);
`proposeMemories`, `checkedIn`, `memoriesReady`; the "still setting up"
rejection before `ready`; `watchSales`' old-sale suppression and batching.

## Acceptance criteria

- [x] `src/ipc.cjs` exports a factory with no top-level Electron use;
      `require("./src/ipc.cjs")` succeeds in plain node.
- [x] `test/ipc-contract.test.cjs` still proves renderer, preload and the IPC
      handlers agree on every channel, reading the new file.
- [x] `test/unit/ipc.test.cjs` covers the nine rules listed in the approach
      with a fake ipcMain and runs in under 2 s.
- [x] `npm run check` passes with the moved code typed as before.
- [x] Layout scan: this item touches no walk; all 21 walks pass on the PR's
      macOS run against the refactored main, which is the proof nothing
      visible changed.

## Notes

- Workstream B1 of the test-pyramid plan. APP-269 and APP-270 retire walks
  whose assertions move into `ipc.test.cjs`; they are blocked on this item.
- Keep `main.cjs` to Electron wiring: window creation, lifecycle, the
  single-instance lock, and assembling the bundle the factory takes.
- Done 2026-11-04 (PR #649). `main.cjs` went from 875 lines to 246. Moved
  into `src/ipc.cjs`'s `Ipc(...)` factory, by line range, not rewritten:
  `registerIpc` (98 handlers by the time it merged; APP-283 and APP-288 added
  two while this was open), `signInToCloudflare`, `request`, `readThrough`,
  `queueReadings`, `showSaved`, `told`, `AFTER_RUN`, `recordCheckIn`,
  `closeCheckIn`, `runNow`, `hasStore`/`hasInbox` with the store and inbox
  addresses, `watchSales` (now returns `{check, stop}`), `hidden`, the
  `TASKS`/`USAGE`/`LOGINS`/`FIRST_RUN_STEPS` sets, the `Ready`, `Suggestions`,
  `FirstRun`, `Seen` and `CheckIns` objects, and every `LoreAgent.create`
  callback as `agentCallbacks(loreHome, outgoing, validEntries)`. Stayed in
  `main.cjs`: `createWindow`, `reveal`, `emit`, `watchBids`, `watchAgents`,
  `boot`/`start`, the lifecycle hooks, and the `badge`, `bids`, `updates`,
  `appearance` and `requests` objects the bundle hands over. The factory takes
  `state.cjs` as a second argument so the tests run against a fake CLI bridge.
  `runtime.cjs` reads Electron's `app` through getters, so it loads in node.
- `test/unit/ipc.test.cjs`: 36 tests over a fake ipcMain, about 0.1 s.
  `node --test` with no arguments already matches `test/unit/`, so `npm test`
  needed no change (XC-097 moves the existing tests into tiers separately).
