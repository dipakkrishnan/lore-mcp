---
id: APP-190
title: Refuse to rebuild Lore.app while a copy is running, and say to relaunch if it happens
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-181, APP-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

`npm run package` overwrites `out/Lore-darwin-arm64/Lore.app` in place. If that
copy is still running, `open Lore.app` only refocuses the old process, and its
lazily loaded modules now come from the new files. The owner saw "The requested
module './text.js' does not provide an export named 'getSystemMessageText'" in
the chat and could not continue, with nothing pointing at the real cause (an app
that was open during the rebuild).

## Proposed approach

- Add a `prepackage` step that exits with a plain message when a process is
  running from the output bundle, telling the owner to quit Lore first.
- When it happens anyway, the app's error text becomes "Lore was updated while it was open. Quit Lore and open it again to continue." instead of the raw module error.

## Acceptance criteria

- [x] `npm run package` stops before touching `out/` when Lore.app from `out/` is running, and says to quit it
- [x] With Lore not running, `npm run package` behaves as before
- [x] A module-mismatch error shows the relaunch advice, not the raw text
- [x] The guard has a test that does not need a real running app

## Notes

Found 2026-10-06 while updating a dogfood copy that had been open since the day
before. Quitting and relaunching fixed it; no packaging dependency was at fault
(both Pi packages were 0.87.1 and exported the function).

Implemented as `app/desktop/support/guard-running.sh`, run by the `prepackage` npm script. `make` does not run it. The relaunch advice is in `reason()` in `renderer.js`, so every place that shows an error gets it. APP-181 still owns the wider raw-error cleanup.
