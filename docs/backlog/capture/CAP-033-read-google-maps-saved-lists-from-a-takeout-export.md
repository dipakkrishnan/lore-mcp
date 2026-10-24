---
id: CAP-033
title: Read Google Maps saved lists and starred places from a Takeout export
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-006, CAP-032]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-19
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

- [x] A Takeout zip or folder is accepted; unrelated Takeout products are
      ignored.
- [x] Each saved list becomes one item that keeps the owner's notes.
- [x] Re-importing a newer export replaces rather than duplicates.
- [ ] Contract test against a recorded, anonymized Takeout sample.

## Notes

- `TakeoutExport` subclasses `ExportReader`, overriding `probe` and `items`. It
  reads only `Saved/*.csv`, `Saved Places.json` and `Reviews.json` from a zip
  or folder (`lore sources connect google-maps <path>`); the desktop's picker
  takes the zip, as for ChatGPT and Claude.
- Items: one per saved list (each place as "Title — note — comment"), one
  "Starred places" item (name and address), one per review (place, date,
  rating, words; a review with neither rating nor words is skipped). Keys are
  the list name, `starred`, and the review's Maps link, so a newer export
  updates in place.
- `MapsPlace` reads both spellings Google has used (`location.name`,
  `five_star_rating_published`, `review_text_published`, `date`; earlier
  `Location.Business Name`, `Star Rating`, `Review Comment`, `Published`).
- The fourth criterion is open: the fixture under
  `tests/fixtures/exports/takeout/` is synthesised from documented field names
  (open-source Takeout parsers and third-party guides; Google publishes no
  schema), not recorded from a real export. The `Comment` and `Tags` columns of
  the list CSVs, whether Takeout's "Saved" product puts non-Maps collections in
  the same folder, and the path and name of `Reviews.json` should be checked on
  the first real export. Record and anonymize one, then tick the box and mark
  the item completed.
- A list deleted from Google Maps stays in Lore after a newer import, as a
  ChatGPT conversation does.

Beli has no API or export and is phone-only. For now, the owner can drag
screenshots of their ranked list into capture, since multimodal capture
already reads images.
