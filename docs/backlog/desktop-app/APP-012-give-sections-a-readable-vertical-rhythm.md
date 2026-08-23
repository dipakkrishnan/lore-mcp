---
id: APP-012
title: Give sections a readable vertical rhythm
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-009, APP-011]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-08-22
---

## Problem

Section labels on Today and Store ("NEEDS YOU", "RECENTLY KEPT", "FOR SALE",
"SALES") sit closer to the card above them than to the card they introduce.
`main` spaces its children 20px apart while `.section` spaces its label from
its own card by 10px, so every label reads as a caption of the previous card
and the page has no visible grouping. The owner's reaction while dogfooding
was "spacing with text just seems generally off", which is the proximity
principle being violated rather than any single number being wrong.

## Proposed approach

Make between-section space clearly larger than within-section space: widen the
gap between sections (roughly 28-32px) and tighten the label-to-card gap
(roughly 6-8px), then check the same rhythm holds for header → composer and
composer → first section on Today, and for the live bar → "NEEDS YOU" on
Store. Review row internals at the same time: the 2px title-to-subtitle gap
and the 10px row padding are tight against 17px serif titles. Keep this to
`styles.css`; no markup changes unless the rhythm cannot be expressed in CSS.

## Acceptance criteria

- [x] On Today and Store, the space above a section label is visibly larger
      than the space between that label and its card.
- [x] The screenshot helper (`support/screenshot.cjs`) renders of `today`,
      `memories`, and `store` are re-checked after the change.
- [x] No row truncates or wraps differently than before at the minimum window
      width.

## Notes

Completed on the APP-011/APP-012 PR: between-section gap 30px (main and
`#content`), label-to-card 8px, row padding 12px, title-to-subtitle 3px.
Re-checked with `support/screenshot.cjs` on today/memories/store and at the
760px minimum width. The helper now signs the renderer in through
`window.__lore.signIn()` so it renders the app shell in dev mode instead of
the welcome gate (the APP-013 note).

Found while dogfooding the packaged app on 2026-08-22. Visual polish was
explicitly deferred in APP-009 until core functionality landed; this is the
first concrete polish item with a measured cause.
