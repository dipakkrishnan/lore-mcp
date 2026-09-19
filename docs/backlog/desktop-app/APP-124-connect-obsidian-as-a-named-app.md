---
id: APP-124
title: Connect Obsidian as a named app, not a folder
priority: P1
effort: M
component: desktop-app
status: completed
related: [STO-003, CAP-004, CAP-007, APP-121, APP-122, APP-120]
blockers: []
dependencies: ["STO-003 for the folder reader and per-source state"]
github_issue: null
created: 2026-09-18
updated: 2026-09-18
---

## Problem

An owner who keeps notes in Obsidian should click Connect next to the word
Obsidian and be done. The connect surface built in `APP-120` offers "a
folder of notes" and mentions Obsidian in the description; the owner has to
know a vault is a folder, find it in a picker, read a preview, and choose a
date range. Nothing persisted says the source is Obsidian, so its mark is
guessed from the label and a rename changes the icon.

## Proposed approach

Make the app the thing the owner connects, with the reader underneath
(`STO-003`'s `folder` kind, unchanged). Three concepts, no second registry:

- **Connector**: the app's identity and what it offers to connect, found
  without asking. `Obsidian` reads the vault registry Obsidian keeps at
  `~/Library/Application Support/obsidian/obsidian.json`.
- **Connection**: the existing saved source, with a `connector` field that
  names the app. The name is `obsidian-<digest>` so a relabel never changes
  identity.
- **Registry**: import, dedupe, review-state preservation and removal, as
  they were.

CLI: `lore sources choices obsidian --json` lists vaults; `lore sources add
--folder PATH --connector obsidian` connects one. The app's Settings card
lists each app as a row: mark, name, one sentence, Connect. Connect opens a
sheet listing the vaults by name with a folder picker as the fallback, and
reads the vault the moment it is chosen. The row then says "Connected ·
<vault> · N notes kept"; a vault with nothing in it is still connected.
Manage offers Read again, Change vault, and Disconnect (keep or delete).
Refresh is the synthesis schedule's pre-run `lore sync`, which already
reads owner sources. Adding Apple Notes (`CAP-007`) is one `Connector`
in Python and one row in `CONNECTORS` in the renderer.

## Acceptance criteria

- [x] Settings offers Obsidian by name with its own mark and one Connect;
      the word folder never appears until the fallback picker.
- [x] Connect lists the vaults Obsidian knows, the open one first, and a
      chosen vault is read at once with no preview or date-range step.
- [x] The row says Connected with what was kept; an empty vault stays
      Connected; a note written after connecting arrives on Read again.
- [x] Disconnect keeps or deletes what was imported and offers Obsidian
      again.
- [x] The saved source carries `connector: "obsidian"` and the CLI refuses
      an unknown app or an app paired with the wrong kind of locator.

## Notes

The vault on this Mac is under Documents, so macOS asks once before the
first read; Lore's own wording on that prompt is `APP-121` and needs the
next signed build. The Obsidian mark is the brand's gradient SVG, unmodified
as its guidelines require, with provenance in the file (`APP-122`).
Verified 2026-09-18 with `support/edge.sh obsidian`: eight checks, all pass.
