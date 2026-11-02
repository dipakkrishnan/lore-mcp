---
id: APP-282
title: Never let an older load undo newer task news
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [XC-072, XC-080]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-02
updated: 2026-11-02
---

## Problem

The `store` walk failed its "unfinished capture is listed" checks whenever it
ran beside another walk (`node support/walks.cjs --jobs 2 store connectors`
failed its first attempt and passed on retry), and passed alone.

The cause is in the renderer. `load()` asks main for the tasks on disk at the
moment it starts, then waits for the slow parts (the snapshot is a Python
CLI call) and assigns everything at once. A `task` event that arrives while
that load is out is newer than what the load read, but the load overwrites
`taskItems` with its older list when it lands, so the news is lost until some
later load. In the app a thread that finished or stopped during a load flips
back to its earlier state on Today. In the walk, the `store` step's last
Confirm starts a load; beside another walk that load takes long enough to land
after the injected "Reply to keep going" task and wipes it. The walk also
injected that task only as an event, with nothing on disk, so any later load
would wipe it too.

## Proposed approach

Remember each task event with the load it arrived during; when a load lands,
lay the news heard since it began over the tasks it read, and forget news
heard before it began (the disk it read already holds that). In the walk,
check that ordering directly (start a load, then hear the news, in one
renderer tick, so the load's read always goes out first), and keep the
unfinished capture on disk as Lore does, so every later load agrees.

## Acceptance criteria

- [x] On origin/main the new check "a task heard while a load is out outlives
      that load" fails every time, alone; with the fix it passes.
- [x] `store` passes on its first attempt with `--jobs 2` beside `connectors`,
      three runs in a row.
- [x] Every walk and `npm test` green, run serially.
- [x] Layout scan: no view the walks scanned before is unscanned after.
