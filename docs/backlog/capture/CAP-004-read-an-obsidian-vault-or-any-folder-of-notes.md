---
id: CAP-004
title: Read an Obsidian vault or any folder of notes
priority: P1
effort: S
component: capture
status: in-review
related: [STO-003, CAP-001, CAP-003, APP-120]
blockers: []
dependencies: ["STO-003 for the source kind and state; a folder can be dropped through lore-capture today"]
github_issue: null
created: 2026-09-17
updated: 2026-10-19
---

## Problem

The largest store of first-person, dated writing most owners have is a
folder of markdown: an Obsidian vault, a Bear or Logseq export, a notes
directory in Dropbox. Today the only way in is to drag the folder into
capture once, which walks it as a one-off and never returns. There is no
way to say "this vault is a source" and have Lore keep reading it.

## Proposed approach

The `folder` kind from `STO-003`, with a picker in the app (native open
panel) and `lore sources add --folder PATH` on the CLI. Read `**/*.md`,
parse YAML frontmatter for a title and any date, and fall back to file
mtime with the snapshot saying so, since Obsidian never writes a created
date and mtime breaks under sync. Skip `.obsidian/`, `.trash/`, and
templates folders. On connect, read the index only and hand the app a
preview (count, date range, skipped-too-short count) before anything
enters the library; the correction flow remains the content gate.

## Acceptance criteria

- [ ] Picking a vault shows a preview with the note count and date range,
      then imports the chosen notes as private memories, each linking to
      its file.
- [ ] A second read imports only new or changed notes.
- [ ] Notes shorter than a sentence are skipped and the count says so.
- [ ] A vault under Documents, Desktop, or Downloads triggers the macOS
      folder prompt once with Lore's own purpose string, not Electron's.

## Notes

Needs `NSDocumentsFolderUsageDescription`, `NSDesktopFolderUsageDescription`,
and `NSDownloadsFolderUsageDescription` in `forge.config.js` (`APP-121`);
without them macOS still prompts but with boilerplate copy. Obsidian Bases
is a view layer; the vault stays plain markdown.

**Prioritization 2026-10-19 (corrected in review):** not promoted; much of this
exists on main. `lore/sources.py` has an `Obsidian` connector (line 405) and a folder
walk that skips `.obsidian`, `.trash` and `templates` (line 248), `lore sources
preview --folder` is in the CLI (`lore/cli.py:825`, `1118`), and `test:edge` includes
an `obsidian` persona. Check each acceptance criterion against that code (preview
with count and date range, re-read of changed notes only, short-note skip count, the
macOS folder prompt strings) and rewrite the item to what is still unmet.
