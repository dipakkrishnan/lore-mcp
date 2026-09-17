---
id: CAP-004
title: Read an Obsidian vault or any folder of notes
priority: P1
effort: S
component: capture
status: in-progress
related: [STO-003, CAP-001, CAP-003, APP-120]
blockers: []
dependencies: ["STO-003 for the source kind and state; a folder can be dropped through lore-capture today"]
github_issue: null
created: 2026-09-17
updated: 2026-09-17
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

- [x] Picking a vault shows a preview with the note count and date range,
      then imports the chosen notes as private memories, each linking to
      its file.
- [x] A second read imports only new or changed notes.
- [x] Notes shorter than a sentence are skipped and the count says so.
- [ ] A vault under Documents, Desktop, or Downloads triggers the macOS
      folder prompt once with Lore's own purpose string, not Electron's.

## Notes

Needs `NSDocumentsFolderUsageDescription`, `NSDesktopFolderUsageDescription`,
and `NSDownloadsFolderUsageDescription` in `forge.config.js` (`APP-121`);
without them macOS still prompts but with boilerplate copy. Obsidian Bases
is a view layer; the vault stays plain markdown.

2026-09-17: the folder reader landed as the first kind in `STO-003` (#297)
and the pick, preview, and Connect flow in `APP-120` (#298): frontmatter
`date`/`created` then mtime, `.obsidian/`, `.trash/`, and `templates/`
skipped, items under a sentence counted and skipped, `--since` kept on the
source so later reads honour it. The last criterion, Lore's own words on the
Documents, Desktop, and Downloads prompts, is the purpose strings in
`APP-121` (#299) and is confirmed by the next signed build.
