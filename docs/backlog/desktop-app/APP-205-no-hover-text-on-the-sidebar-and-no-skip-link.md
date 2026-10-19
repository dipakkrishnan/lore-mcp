---
id: APP-205
title: No hover text on the sidebar, and no skip link
priority: P2
effort: XS
component: desktop-app
status: completed
related: [APP-201]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-15
updated: 2026-10-15
---

## Problem

Hovering over Memories, For Sale, Connectors or Automations in the sidebar
brought up a paragraph of text over the page. Dipak: "Can we nuke all these
hover texts over the left sidebar". When the window got keyboard focus, a
website-style "Skip to content" link appeared under the traffic lights.
Dipak: "what is this?"

## Proposed approach

Remove both. Each tab explains itself once it's open, and Help & FAQ covers
the rest. A Mac app has no page header to skip past.

## Acceptance criteria

- [x] The sidebar shows no hover text.
- [x] There is no "Skip to content" link.

## Notes

Oct 15, done: removed the four `.tip` spans and their CSS from `index.html`
and `styles.css`, and the `.skip-link` anchor and its CSS.
