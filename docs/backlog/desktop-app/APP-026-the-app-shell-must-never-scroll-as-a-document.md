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

Clamp the root: `html, body { overflow: hidden }`. `#main` remains the
only scroll container. Verified by the same repro: after the clamp,
forcing `documentElement.scrollTop = 400` leaves it at 0.

## Acceptance criteria

- [x] With a long thread, the document cannot scroll; only `#main` does.
- [x] Repro script confirms `documentElement.scrollTop` stays 0.
- [x] Desktop typecheck and tests pass.
