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

Pin the signed-in app shell to the viewport with CSS instead of leaving it in
document flow. Keep app-owned scrolling targeted at `#main` and focus calls
using `preventScroll`; no frame-by-frame viewport correction is needed.

## Acceptance criteria

- [x] With a long thread, the document cannot scroll; only `#main` does.
- [x] Electron probe confirms the root stays viewport-height and
      `documentElement.scrollTop` stays 0 after forced scroll and focus.
- [x] Desktop typecheck and tests pass.

## Notes

Verified with 2,175px of main content in a 732px viewport: root and body
remained 732px, forced root scroll stayed at 0, and focusing the last field
scrolled only `#main`. The requestAnimationFrame watchdog was removed.
