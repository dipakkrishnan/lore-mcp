---
id: APP-086
title: Show attached file names in the capture thread
priority: P3
effort: XS
component: desktop-app
status: in-review
related: [APP-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
---

## Problem

Dropping a file on the composer shows a chip with its name until Capture is
pressed. The thread that opens then carries only the seeded turn "Please read
the attached files." The file name is gone, so an owner who attached the wrong
file, or several, cannot tell from the thread what Lore is reading, and the
finished thread gives no record of where the memories came from (dogfood
2026-09-05, `tank-log.txt` drop).

## Proposed approach

Render the attached names as chips inside the owner's turn, the same way the
composer showed them before sending, and keep them in the closed thread.

## Acceptance criteria

- [ ] After Capture with one or more attachments, the owner turn lists each file name.
- [ ] Reopening the finished thread from Today still shows them.

## Notes

Screenshots `61-dogfood-dropped.png` and `62-dogfood-attach-submitted.png`.
