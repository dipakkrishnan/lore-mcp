---
id: APP-222
title: A UI that feels alive
priority: P2
effort: M
component: desktop-app
status: completed
related: [APP-218, APP-221]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-19
---

## Problem

Next to Grok Bot, Lore felt still. A working thread showed three bouncing dots
and one label, so the owner could not tell what Lore was doing or how long it
took. Replies landed as whole blocks, and the sidebar was a flat cream panel.

## Fix

- Every in-progress label (the thread's working line, the wait for an agent's
  first save, Today's reading row) has a slow light sweep across its text. The
  sweep replaces the typing dots.
- The sidebar is the native frosted sidebar material, with a translucent cream
  over it. The main pane stays solid cream. Inactive sidebar items are dimmed
  a notch.
- As a reply streams in, only the words that just arrived fade in. Finished
  messages, history and code blocks never animate.
- While Lore works, its tool activity shows as small step rows in plain owner
  words ("Read 4 notes", "Checked your store"), each with how long it took. The
  current step shimmers. Finished steps fold into one "4 steps · 12s" line that
  opens on click. Raw tool names, commands and paths never reach the page.
- Everything here is still under reduced motion.

## Notes

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in 9feb663. Closed out in the review-queue pass.
