---
id: APP-067
title: Keep task content from scrolling under the sticky header
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-054, APP-046]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

In a task thread the header (`← Today`, the eyebrow, the title) is sticky at
the top of `main`, but `main` carries its own top padding above it, so
scrolled content shows through that strip: an off-thread notice peeks out above
`← Today`, and the blueprint card's heading sits half under "Set up your
Lore". Scrolling a card into view (`renderer.js:1058`) subtracts a fixed 16px
and ignores the header's height, so the first question lands under the header
and the owner scrolls up to find it (dogfood 2026-09-04, shape and interview
cards).

## Proposed approach

Move the top padding inside the sticky header (`styles.css:131-133`) so the
header's background covers the full strip, and subtract the header's rendered
height when scrolling a card into view.

## Acceptance criteria

- [ ] No thread content is visible above or through the sticky header at any
      scroll position.
- [ ] Opening a question, memories or blueprint card lands its first line
      fully below the header without manual scrolling.

## Notes

Seen on both the blueprint-review card and the interview card in the
`dogfood:new` pass.
