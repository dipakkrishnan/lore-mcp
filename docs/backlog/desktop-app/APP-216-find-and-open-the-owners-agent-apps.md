---
id: APP-216
title: Find the owner's agent apps on this Mac and open them
priority: P0
effort: S
component: desktop-app
status: completed
related: [APP-215, APP-207]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-19
---

## Problem

Connecting an agent means the owner has to know which one they use, then
find the app and its connector settings. Lore can see which agent apps are
installed, and could open the right one, but doesn't.

## Proposed approach

Main checks a fixed list of known agent apps (Grok Bot, ChatGPT, Claude,
and others as they're added) under /Applications and ~/Applications and
reports which are installed. A second IPC opens one of them by its agent id,
never by a path the renderer supplies. The connect card and sheet show
"Open Grok Bot" when it's installed.

## Acceptance criteria

- [x] Installed agent apps are reported by id; nothing else on disk is read.
- [x] Open <agent> launches the installed app; the IPC rejects unknown ids.
- [x] Unit tests cover found, not found, and an unknown id.

## Notes

**Completed (verified 2026-10-19):** every acceptance criterion is checked and the work is on main in 2ea1c94 (#481). Status was left stale after merge; closed out in the review-queue pass.
