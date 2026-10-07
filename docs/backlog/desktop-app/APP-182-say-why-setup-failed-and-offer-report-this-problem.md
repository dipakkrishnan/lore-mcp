---
id: APP-182
title: Say why setup failed and offer Report this problem
priority: P1
effort: S
component: desktop-app
status: ready
related: [APP-085, APP-105, APP-181]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

When first-run setup fails, the app shows "Lore could not finish setting up on
this Mac." and Try again, with no cause and no next step. `boot()` in
`app/desktop/src/main.cjs` only sends the real error to `console.error`, where
a seller can't see it or send it to us.

## Proposed approach

- Send a short reason to the renderer with the progress error (e.g. "Lore
  couldn't write to its folder", "Python failed to start").
- Under it: Try again, and Report this problem, which opens the feedback
  dialog (APP-105) with the error attached.

## Acceptance criteria

- [ ] The setup failure screen names the cause in one plain sentence
- [ ] Report this problem sends the full error without the seller copying anything
- [ ] Try again still works

## Notes

Filed from the 2026-10-06 new-seller audit.
