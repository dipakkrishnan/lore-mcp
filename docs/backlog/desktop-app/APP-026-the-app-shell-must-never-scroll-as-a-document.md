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

Two layers, because CSS alone cannot do it: `overflow: clip` on
html/body stops user scrolling, but per spec the viewport stays
script-scrollable whatever the root's overflow value — `focus()` and
`scrollIntoView` still moved it in the repro. A one-line scroll listener
snaps `documentElement.scrollTop` back to 0. `#main` remains the only
scroll container; its own scroll position is unaffected.

## Acceptance criteria

- [x] With a long thread, the document cannot scroll; only `#main` does.
- [x] Repro script confirms `documentElement.scrollTop` returns to 0 after a forced scroll.
- [x] Desktop typecheck and tests pass.
