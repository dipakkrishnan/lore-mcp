---
id: APP-233
title: Delete one memory, and dismiss one card on Today
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-212, APP-213, APP-229]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-21
updated: 2026-10-21
---

## Problem

The owner has no way to delete a single memory. The app has no Delete,
`lore memory` only shows, renames and edits, and an agent can only take back
its own saves. The only bulk delete is disconnecting a whole source. A
synthesized memory deleted by hand from the database comes back on the next
sync, because its file and its INDEX.md line are still in `~/.lore/memories`.

Today's "New memories" section can only be cleared all at once. The owner
can't put away one agent's card and keep the rest.

## Proposed approach

- `lore memory delete <id> [--json]` deletes the row through the store. When
  Lore wrote the memory to its own memories folder, it also deletes the file
  and the INDEX.md lines that name it, so no sync brings it back. A memory
  any publication cites (live or taken down) is kept, with a plain reason.
- The memory sheet gets Delete next to Rename and Edit, with an inline
  confirm in the destructive style of "Delete them too".
- Each card in New memories gets an × on hover. It drops only that card's
  runs (picked by when each finished and who it was) from the ready file,
  and the dock badge recounts from what is left.

## Acceptance criteria

- [x] `lore memory delete` deletes one memory, refuses an unknown id, and
  keeps one a publication cites.
- [x] Deleting a synthesized memory removes its file and INDEX.md line; the
  next sync adds nothing back. A file outside Lore's folder is never touched.
- [x] Delete in the memory sheet asks first, then closes the sheet and
  refreshes the library.
- [x] Dismissing one card leaves the others, and the badge counts only what
  is left.

## Notes

- A memory read from a folder Lore doesn't own (Claude Code, Codex, Obsidian,
  an owner's folder) is deleted as a row only, so the next read of that
  source brings it back. Left open: hide it with a tombstone, or say so in
  the confirm.
