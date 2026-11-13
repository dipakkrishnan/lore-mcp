---
id: CAP-004
title: Read an Obsidian vault or any folder of notes
priority: P3
effort: XS
component: capture
status: in-review
related: [STO-003, CAP-001, CAP-003, APP-120]
blockers: []
dependencies: ["STO-003 for the source kind and state; a folder can be dropped through lore-capture today"]
github_issue: null
created: 2026-09-17
updated: 2026-11-13
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
- [x] A second read imports only new or changed notes.
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

**Prioritization (2026-11-12):** Priority P3 (was P1), effort XS (was S).
Stays in-review. Before it can be ready: Check criteria 1-4 against the code
(Obsidian connector, folder walk skipping .obsidian/.trash/templates,
preview() with count, date range and skipped count) and tick those met; then
close, or rewrite to what is still unmet (most likely seeing the macOS
folder prompt on the signed build). Prioritization flag (not acted on): done
(likely).

**Close-out (2026-11-13):** Stays in-review. Checked each criterion.
- C1 partly met. `lore/sources.py` `preview()` returns `count`, the `from`/`to`
  date range and `skipped`, and `lore sources preview --folder` exposes it.
  Imports are private and each `Item` keeps the file path as `source_path`. But
  the desktop app never shows that preview. `openConnect()` in
  `app/desktop/src/renderer.js` goes from "Choose a folder…" straight to
  `connectSource`. The app needs a preview step, or the criterion needs
  rewording to the CLI.
- C2 met. Store imports fingerprint content and count `unchanged`
  (`tests/test_sources.py::test_unchanged_files_are_counted_and_not_rewritten`,
  `tests/test_cli.py` folder walk). A deleted memory stays gone on re-read
  (`test_a_deleted_folder_memory_stays_gone_when_the_folder_is_read_again`).
- C3 met in the CLI only. `Reader.keeps()` drops anything shorter than a
  sentence, and `preview()` counts it as `skipped`
  (`test_preview_counts_what_would_be_kept_and_writes_nothing`). The app shows
  no such count, which is tied to C1.
- C4 code done, observation open. `app/desktop/forge.config.js` sets
  `NSDocumentsFolderUsageDescription`, `NSDesktopFolderUsageDescription` and
  `NSDownloadsFolderUsageDescription` with Lore's copy. Someone still has to see
  the prompt once on a signed build.
