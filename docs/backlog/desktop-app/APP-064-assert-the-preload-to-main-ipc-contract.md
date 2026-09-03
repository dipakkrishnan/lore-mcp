---
id: APP-064
title: Assert the preload-to-main IPC contract in a test
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-039, APP-002, APP-058]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-09-03
---

## Problem

`preload.cjs` exposes 24 members on `window.lore`, 22 of them
`ipcRenderer.invoke` channels. `main.cjs` registers 22 `ipcMain.handle`
channels. The renderer uses all 24. Today the three sides agree exactly — and
nothing checks that they do.

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

- [ ] A test fails when a preload channel has no handler in main.
- [ ] A test fails when a main handler has no preload channel.
- [ ] A test fails when the renderer references a `window.lore` member preload
      doesn't expose, including one passed as a reference rather than called.

## Notes

Found while auditing desktop test coverage (2026-09-03); the three sides were
verified to match at that commit, so this lands as a guard rather than a fix.
