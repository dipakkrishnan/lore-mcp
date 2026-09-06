---
id: APP-088
title: Put Add Memory beside the title, not above it
priority: P3
effort: XS
component: desktop-app
status: completed
related: [APP-067, APP-051]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

On Memories, "+ Add Memory" sat in the action row above the header text, so
the button's top was a full row higher than "44 private" and the title. The
header read as two stacked things instead of one (dogfood 2026-09-05).

## Proposed approach

Give the header a second column and put the button there, centered on the
eyebrow and title.

## Acceptance criteria

- [x] On Memories, the button sits to the right of the title block, vertically centered on it, and the header's height is the text's height.
- [x] Task views keep "← Today" and "Start over" above the eyebrow as before.

## Notes

Done 2026-09-05. The header is a two-column grid; every child but the button
stays in the first column, so the task action row, eyebrow and title stack as
they did.
