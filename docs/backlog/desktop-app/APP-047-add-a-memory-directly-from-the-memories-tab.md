---
id: APP-047
title: Add a memory directly from the Memories tab
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-011, APP-046]
blockers: [APP-046]
dependencies: []
github_issue: "https://github.com/dipakkrishnan/lore-mcp/issues/170"
created: 2026-09-01
updated: 2026-09-01
---

## Problem

Capturing a memory only works from Today: the composer (`#composer` /
`captureArea` in `app/desktop/src/renderer.js`) is hidden whenever `view !==
"today"` (`renderer.js:538`). An owner reading their library on the Memories
tab who thinks of something worth keeping has to switch tabs to say so,
losing whatever they were looking at.

## Proposed approach

Add a "+ Add Memory" button to the Memories view's fixed header (once
APP-046 gives that header a stable home). Clicking it opens a popup/sheet
that reuses the existing capture composer and its submit handler
(`composer.addEventListener("submit", ...)`, `renderer.js:1102`) rather than
building a second capture pipeline, so a memory added this way goes through
the same synthesis path as one captured from Today.

## Acceptance criteria

- [ ] Memories tab's fixed header has a visible "+ Add Memory" action
- [ ] Clicking it opens a capture flow equivalent to Today's, and a
      successful capture shows up in the Memories list without a manual
      refresh
- [ ] Dismissing the popup without submitting leaves the Memories list
      unchanged

## Notes

Cataloged from GitHub issue #170 ("Memories tab layout enhancements"), split
from the fixed-header ask filed as APP-046 — this button depends on that
header existing.
