---
id: APP-092
title: Explain Memories and For Sale on hover
priority: P3
effort: XS
component: desktop-app
status: completed
related: [APP-091, APP-054]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

The two tabs that carry the product's model, private memories on this Mac
and approved publications that reach buyers only after a push, explain
themselves nowhere. An owner asking "what is here, and who can see it?"
had to infer it from chips and counts (dogfood 2026-09-05).

## Proposed approach

A small note beside each tab on hover or keyboard focus, two sentences,
in the app's own surface style rather than the system tooltip.

## Acceptance criteria

- [x] Hovering or focusing Memories or For Sale shows a note to the right of the sidebar after a short delay; leaving hides it.
- [x] The notes name what the tab holds and who can see it, with no plumbing terms.
- [x] Reduced-motion users get the note without the fade.

## Notes

Done 2026-09-05. Memories: "What your agents have learned, kept on this
Mac. Nothing here leaves it unless you draft it for sale and approve it."
For Sale: "What you approved to sell. Buyers see it once you push it to
your store; until then it waits here."
