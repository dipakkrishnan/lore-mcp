---
id: APP-046
title: Keep the Memories header fixed while scrolling
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-011, APP-047]
blockers: []
dependencies: []
github_issue: "https://github.com/dipakkrishnan/lore-mcp/issues/170"
created: 2026-09-01
updated: 2026-09-01
---

## Problem

The Memories view's title ("Memories") and count ("641 private") live inside
`main header` and the per-view `section()` heading respectively, both direct
children of `main` (`app/desktop/src/renderer.js`). `main` itself is the
scroll container (`overflow: auto` in `app/desktop/src/styles.css:131`), so
scrolling through a long memory list scrolls the title and count away with
it. On a library this size, the owner loses the count — and the anchor for
whatever action lands there next (see APP-047) — as soon as they scroll past
the first screen.

## Proposed approach

Split `main`'s single scrolling region into a fixed header band and an
independently scrolling body for the Memories view specifically (or
generally, if it reads cleanly for Today/Store/Settings too): keep `main
header` and the "N private"/"N matches" heading pinned, and give the
`.card` list beneath it its own `overflow: auto`. Needs a layout pass in
`styles.css` around `main`/`main header`/`.section`, not just a `position:
sticky` bolt-on, since `main` currently owns the padding and gap for
everything inside it.

## Acceptance criteria

- [ ] Scrolling the Memories list keeps "Memories" and the private count
      visible at all times
- [ ] Today, Store, and Settings views are unaffected (or deliberately
      updated the same way, not left inconsistent)

## Notes

Cataloged from GitHub issue #170 ("Memories tab layout enhancements"), which
bundled this with an "Add Memory" button in the same fixed bar — split out
as APP-047 since the button is a separate, independently-completable piece
of work.
