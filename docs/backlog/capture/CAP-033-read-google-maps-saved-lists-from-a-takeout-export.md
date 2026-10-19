---
id: CAP-033
title: Read Google Maps saved lists and starred places from a Takeout export
priority: P2
effort: S
component: capture
status: ready
related: [CAP-006, CAP-032]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

People keep their places in Google Maps lists ("Best coffee in SF",
"Want to go"), with notes. Lore can't reach them, so the owner has to retype
their recommendations to draft from them.

## Proposed approach

An `ExportReader` for a Google Takeout archive (zip or unzipped folder):

- `Takeout/Saved/<list>.csv` gives one item per list, with each place's title,
  note, URL and comment.
- `Takeout/Maps (your places)/Saved Places.json` (GeoJSON) gives starred
  places with their address.
- Reviews the owner wrote (`Reviews.json`) become items too, when present.

The guide tells the owner to choose only "Saved" and "Maps (your places)" at
takeout.google.com so the export stays small. A newer export replaces the old
one, as with ChatGPT/Claude exports.

## Acceptance criteria

- [ ] A Takeout zip or folder is accepted; unrelated Takeout products are
      ignored.
- [ ] Each saved list becomes one item that keeps the owner's notes.
- [ ] Re-importing a newer export replaces rather than duplicates.
- [ ] Contract test against a recorded, anonymized Takeout sample.

## Notes

Beli has no API or export and is phone-only. For now, the owner can drag
screenshots of their ranked list into capture, since multimodal capture
already reads images.
