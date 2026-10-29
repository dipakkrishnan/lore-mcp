---
id: APP-254
title: Keep Lore running in the tray on Windows
priority: P3
effort: M
component: desktop-app
status: ideation
related: [APP-253, APP-251]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

On Windows, closing the window quits the app (main.cjs:834), which stops routines, the agent watch and
the evening check-in. The dock badge (main.cjs:44), vibrancy/hiddenInset chrome (main.cjs:494-498),
askForMediaAccess (108), the x-apple settings link (386), /Applications agent-app lookup
(agents.cjs:76), and "this Mac"/⌘/Finder copy are macOS-only.


## Proposed approach

Add a Tray with Open/Quit, hide-to-tray on close, and an "Open Lore when I sign in" setting
(setLoginItemSettings). Taskbar overlay icon for the red number. Mica + titleBarOverlay. Hide the
privacy deep link and agent-app buttons on Windows. One platform flag from preload drives the copy
(PC, Ctrl, File Explorer, taskbar).


## Acceptance criteria

- [ ] Closing the window leaves routines running; a due routine runs with the window closed
- [ ] New memories show as a taskbar overlay count
- [ ] No "Mac", ⌘ or Finder strings visible on Windows (screenshot walk)

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
