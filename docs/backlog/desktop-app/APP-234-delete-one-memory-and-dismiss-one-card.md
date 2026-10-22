---
id: APP-234
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

- `lore memory delete <id> [--json]` deletes a memory Lore owns: one the owner
  captured, or one Lore wrote to its own memories folder, which also loses its
  file and the INDEX.md lines that name it, so no sync brings it back.
- A memory an app, a folder or an agent brought in (Claude Code, Codex,
  Obsidian, an owner's folder, an agent's save) is discarded instead, the
  status `lore review` already sets. Its row stays, so reading the source
  again, or the agent saving under the same key, keeps it discarded; Inventory,
  the app's search, Today, the check-in and the synthesis agent read only
  private memories, and a connector's count leaves it out.
- A memory any publication cites (live or taken down) is kept, with a plain
  reason.
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
- [x] Deleting a memory from a folder or an agent leaves its file alone and
  discards it; reading the folder again, or the agent saving it again, does
  not bring it back.
- [x] Delete in the memory sheet asks first, then closes the sheet and
  refreshes the library, and the memory leaves any Today card (a card it
  empties goes too), so Today never opens a memory that is gone.
- [x] Dismissing one card leaves the others, and the badge counts only what
  is left.

## Notes

- A discarded memory can still be brought back with
  `lore review --status discarded`; nothing in the app offers that.
