---
id: APP-064
title: Assert the preload-to-main IPC contract in a test
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-039, APP-002, APP-066]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-10-21
---

## Problem

`preload.cjs` exposes 26 members on `window.lore`, 24 of them
`ipcRenderer.invoke` channels. `main.cjs` registers 24 `ipcMain.handle`
channels. Today the three sides agree exactly — and nothing checks that they
do. The counts move with every feature (`schedule:install` and `pricing:set`
were the two most recent), which is the point: each new channel is another
place for the three sides to drift apart silently.

`APP-039` is what that costs: `agent:status` was exposed in preload and called
by the renderer with no handler in main, which logged an error on every single
launch and returned nothing where the renderer expected a credential list. It
was found by reading the console, not by a failing test, and the same
mismatch in the other direction — a handler nobody calls, or a channel renamed
on one side — is equally invisible.

This is the cheapest test in the desktop app to write and the one that maps to
a bug that actually shipped.

## Proposed approach

One test in `test/app.test.cjs` that reads the two files as text and compares
the sets: every `ipcRenderer.invoke("x")` in `preload.cjs` has a matching
`ipcMain.handle("x")` in `main.cjs`, and vice versa. Static parsing is enough
and needs no Electron — `main.cjs` can't be required outside it anyway, which
is exactly why the check has to be textual rather than behavioral.

Extend it to the renderer if it stays cheap: every `window.lore.<name>` the
renderer references exists in preload. Note that the renderer passes
`window.lore.push` as a function reference rather than calling it, so a naive
`lore\.\w+\(` scan under-counts — match member access, not calls.

## Acceptance criteria

- [x] A test fails when a preload channel has no handler in main.
- [x] A test fails when a main handler has no preload channel.
- [x] A test fails when the renderer references a `window.lore` member preload
      doesn't expose, including one passed as a reference rather than called.

## Notes

Found while auditing desktop test coverage (2026-09-03); the three sides were
verified to match at that commit, so this lands as a guard rather than a fix.

**Prioritization 2026-10-19:** promoted to `ready`. No open blockers, no commit on main implements it, and the acceptance criteria are concrete and checkable. Priority and effort unchanged.

**Implemented 2026-10-21** in `app/desktop/test/ipc-contract.test.cjs`, a file of its
own beside `ci-edge.test.cjs` rather than in `test/app.test.cjs`: seven open PRs
edit `app.test.cjs`, and this test needs none of its scratch-home setup. `npm test`
(`node --test`) and the `desktop-check` CI job pick it up with no other change.

- Channels are read as text (`ipcRenderer.invoke("…")` in `preload.cjs`,
  `ipcMain.handle("…")` in `main.cjs`), since `main.cjs` can't load outside
  Electron. The members `window.lore` exposes come from running `preload.cjs`
  against a stub `require("electron")` and reading the object it hands
  `exposeInMainWorld`, so nested keys and comments are not mistaken for members.
- The renderer side matches `window.lore.<member>` and `window.lore?.<member>`
  wherever they appear, so `window.lore.push` passed as a reference counts. Any
  other use of `window.lore` (bracket access, destructuring, an alias) fails the
  test, because it would hide members from the scan.
- Also fails when `main.cjs` handles a channel twice: Electron throws on the
  second `ipcMain.handle` at launch.
- A fourth test feeds the same helpers synthetic preload, main and renderer text
  with each kind of drift, so every criterion is shown failing, not only passing
  on today's files. Each was also checked by hand, by adding a preload-only
  channel, a main-only handler, a duplicate handler, an unexposed renderer
  member and a destructured `window.lore`: each turned exactly one test red.
- The counts in `## Problem` are from 2026-09-03. On main at 89f7734 there are
  84 invoke channels and 84 handlers, all matched, and the renderer uses 86
  members: the 84, plus `pathFor` and `onAgentEvent`.
- Not covered: the one push channel (`agent:event`, `webContents.send` to
  `ipcRenderer.on`), the order handlers register in (see APP-039), and the
  `Window.lore` type in `types.d.ts`, which `tsc` already ties to the renderer.
  A handler registered with a non-literal channel name would not be seen.
  Today there are none.
