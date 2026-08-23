---
id: APP-026
title: The app shell must never scroll as a document
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-012, APP-020]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

With a long thread open, scrolling far enough shoved the whole shell —
sidebar included — off the top, leaving empty beige below (Dipak,
2026-08-23 dogfood). Reproduced: `document.documentElement.scrollHeight`
reached 984px in a 760px window while `body` stayed 760px, so the html
element itself was scrollable by 224px; any `focus()` or
`scrollIntoView` could then scroll the document instead of `#main`.

## Proposed approach

Three layers, found the hard way. `overflow: clip` on html/body stops
user scrolling, but the viewport stays script-scrollable regardless of
the root's overflow value — and Chromium dispatches no scroll event for
those scrolls, so a listener can never snap it back. So: (1) the app's
own code never scrolls the viewport — thread and card scrolling set
`#main.scrollTop` directly, and every `focus()` passes
`preventScroll: true`; (2) a requestAnimationFrame watchdog resets
`documentElement.scrollTop` for engine-initiated scrolls (caret
visibility while typing); (3) `overflow: clip` keeps user input from
scrolling the root. `#main` remains the only scroll container.

## Acceptance criteria

- [x] With a long thread, the document cannot scroll; only `#main` does.
- [x] Repro script confirms `documentElement.scrollTop` returns to 0 after a forced scroll.
- [x] Desktop typecheck and tests pass.
