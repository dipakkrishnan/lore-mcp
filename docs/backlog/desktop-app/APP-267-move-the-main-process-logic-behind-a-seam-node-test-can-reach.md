---
id: APP-267
title: Move the main-process logic behind a seam node:test can reach
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-062, APP-064, APP-269, APP-270]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
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

- [ ] `src/ipc.cjs` exports a factory with no top-level Electron use;
      `require("./src/ipc.cjs")` succeeds in plain node.
- [ ] `test/ipc-contract.test.cjs` still proves renderer, preload and the IPC
      handlers agree on every channel, reading the new file.
- [ ] `test/unit/ipc.test.cjs` covers the nine rules listed in the approach
      with a fake ipcMain and runs in under 2 s.
- [ ] `npm run check` passes with the moved code typed as before.
- [ ] Layout scan: this item touches no walk; all 21 walks pass on the PR's
      macOS run against the refactored main, which is the proof nothing
      visible changed.

## Notes

- Workstream B1 of the test-pyramid plan. APP-269 and APP-270 retire walks
  whose assertions move into `ipc.test.cjs`; they are blocked on this item.
- Keep `main.cjs` to Electron wiring: window creation, lifecycle, the
  single-instance lock, and assembling the bundle the factory takes.
