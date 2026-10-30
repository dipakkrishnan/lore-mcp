---
id: MON-049
title: Turn a dropped .rtfd document into one piece named after it
priority: P3
effort: XS
component: monetization
status: in-review
related: [MON-044, MON-048, MON-050]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-23
updated: 2026-10-23
---

## Problem

`.rtfd` is in `CONVERTIBLE` (`lore/collection.py`), but on macOS an `.rtfd`
document is a directory bundle. `_files` checks `path.is_dir()` first, so
it walks into the bundle and finds `TXT.rtf`. `_read` then titles the piece
with `path.stem`, so every TextEdit document with an image becomes a piece
named **TXT**. The same happens to an `.rtfd` inside a dropped folder.

Checked on main 1c127ed: dropping `Letter.rtfd/` (holding `TXT.rtf`) gives
`_read(...) == ("TXT", "Hello from rtfd")`.

## Proposed approach

Treat a directory whose suffix is `.rtfd` as one file, both when dropped
directly and during the folder walk. Don't descend into it. Pass the bundle
path itself to `textutil -convert txt`, which reads rtfd input.

## Acceptance criteria

- [ ] With `subprocess.run` stubbed, dropping `Letter.rtfd` produces exactly
      one piece titled `Letter`, and textutil's input argument ends in
      `Letter.rtfd`.
- [ ] A dropped folder holding `Letter.rtfd/TXT.rtf` produces one `Letter`
      piece; nothing under `Letter.rtfd/` is walked.
- [ ] No piece is titled `TXT`.
- [ ] Covered by tests in `tests/test_collection.py` that run without macOS.

## Notes

`tests/test_collection.py` has no `_files`/`_read` tests yet. Open PR #427
reuses `_files`/`_read` for `sell()`, so this fix reaches both paths. Other
bundle formats (`.pages`) are not in `CONVERTIBLE` and are out of scope.
