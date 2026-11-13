---
id: APP-086
title: Show attached file names in the capture thread
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-11-12
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

**Prioritization 2026-10-19:** promoted to `ready`. No open blockers, no commit on main implements it, and the acceptance criteria are concrete and checkable. Priority and effort unchanged.

**Prioritization (2026-11-12):** Priority P2 (was P3), effort S (was XS).
Moved back from ready to in-review. Before it can be ready: The bug is real
(send() shows only "Please read the attached files."). Criterion 2 says
"reopening the finished thread from Today", which is now the Inbox; restate
it there, then it can go back to ready. Effort is S because names must
survive in history.
