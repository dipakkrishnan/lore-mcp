---
id: APP-111
title: Show a memory's metadata as properties on the sheet
priority: P3
effort: S
component: desktop-app
status: in-review
related: [APP-096, APP-037, APP-075, APP-043, APP-108]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-12
updated: 2026-09-12
---

## Problem

A memory carries more than its title and content: when it was captured, where
it came from (dictated in the app, imported from Claude Code or Codex, drafted
by the agent), which project it belongs to, and whether it is private or for
sale. The sheet shows none of this as a block the owner can scan. The
Memories list shows a date; the rest is either in the content, in a chip, or
nowhere.

Obsidian renders a note's frontmatter as a Properties table (walked
2026-09-11): each row has a type icon, a name, and a value, dates get a date
picker, and an "Add property" row sits under the list. The metadata is
readable at a glance and editable in place without touching the body.

## Proposed approach

A properties block at the top of the memory sheet, above the content:

- **Captured** — the date, from `created_at`.
- **Source** — plain words for `source`/`origin`: "Said in Lore", "Imported
  from Claude Code", "Imported from Codex", "Drafted by Lore".
- **Project** — the `project` string when it is set; hidden when empty.
- **Status** — "Private" or "For sale", with the latter linking to the
  publication on For Sale.
- **Connections** — the count from `APP-108`, once it exists.

Read-only in this item, except Project, which is the one field an owner has a
reason to correct; editing it goes through the existing edit path (`APP-037`).
No "Add property" row: Lore's schema is fixed and inventing fields is not an
owner job.

## Acceptance criteria

- [ ] The memory sheet shows captured date, source, project (when set), and status as labelled rows above the content.
- [ ] Source uses plain words for every `source`/`origin` pair the snapshot can produce, with no raw identifiers.
- [ ] Status "For sale" links to the matching entry on For Sale.
- [ ] Project can be edited in place and saves through the same path as content edits.

## Notes

Filed 2026-09-12 from an operated comparison of Obsidian 1.13's Properties
view against the Lore memory sheet. The `memories` table in `lore/store.py`
already has `source`, `origin`, `project`, `status`, `created_at`, and
`updated_at`; this is a rendering item until `APP-108` adds connections.
