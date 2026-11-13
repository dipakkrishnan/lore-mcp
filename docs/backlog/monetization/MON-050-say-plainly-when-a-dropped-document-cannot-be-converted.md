---
id: MON-050
title: Say plainly when a dropped document can't be converted, and never fetch its remote images
priority: P2
effort: XS
component: monetization
status: completed
related: [MON-044, MON-048, MON-049, MON-023]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-23
updated: 2026-11-13
---

## Problem

`Collections._read` (`lore/collection.py`) converts `.docx`, `.html`,
`.webarchive` and similar files with `textutil` under `timeout=60`. That
has three problems:

- A timeout raises `subprocess.TimeoutExpired`, a `SubprocessError`.
  `cli.main` catches only `(OSError, ValueError)`, so `lore collection add`
  dies with a traceback and records no `cli.failed` event, although
  `collection` is in `usage.COMMANDS`. The desktop app shows the owner the
  last stderr line: `subprocess.TimeoutExpired: Command '[...]' timed out
  after 60 seconds`.
- A missing `textutil` (the CLI on Linux) prints
  `lore: [Errno 2] No such file or directory: 'textutil'`.
- `textutil` runs without `-noload`. Per `man textutil`, HTML and
  webarchive conversion loads subsidiary resources. A dropped page with
  remote images makes network requests while it is read, which leaks that
  the owner opened it. Those requests are also the likeliest reason a
  conversion hangs.

## Proposed approach

Pass `-noload` for `.html`, `.htm` and `.webarchive`. Turn
`TimeoutExpired` and `FileNotFoundError` from `textutil` into `ValueError`s
that name the file and say what to do ("paste its text instead").
`deploy.py` already converts `TimeoutExpired` this way (MON-023).

## Acceptance criteria

- [x] With `subprocess.run` patched to raise `TimeoutExpired`, then
      `FileNotFoundError`, `cli.main(["collection", "add", <id>, ...])`
      returns 1. Stderr is one line that names the file and contains no
      `Traceback` or `Errno`, and `cli.failed` is recorded for `collection`.
- [x] textutil's arguments include `-noload` for `.html`, `.htm` and
      `.webarchive` input, checked in a test.
- [x] Covered by tests in `tests/test_collection_drops.py` (or `tests/test_cli.py`
      for the `main` exit path).

## Notes

The desktop wrapper (`state.cjs`) also stops a `lore` run at 120 s. Two
files that each take the full 60 s go over that limit before Python fails,
and the owner sees only "Lore could not finish that". `-noload` should make
that rare. Lowering the per-file timeout is a possible follow-up, not part
of this item. If one file in a dropped folder fails, the whole drop is
refused. Reads finish before any store write, so nothing is half-added.
That is a deliberate choice and is left alone here. Open PR #427 reuses
`_read` for `sell()`.

**Prioritization (2026-11-12):** Priority P2 (was P3). Promoted to ready:
unblocked, criteria checkable, and the premise checked against the code.

**Implementation (2026-11-13):** `Collections._read` (`lore/collection.py`)
passes `-noload` for `.html`, `.htm` and `.webarchive`. It turns textutil's
`TimeoutExpired` into "Lore took too long converting <file>; paste its text
instead" and a missing `textutil` into "Lore can't convert <file> on this
computer; paste its text instead". Both are `ValueError`s, so `cli.main`
prints one `lore:` line, returns 1 and records `cli.failed` for
`collection`. Tests: `test_a_document_that_cannot_be_converted_fails_in_one_plain_line`
(`tests/test_collection.py`) and
`test_a_web_page_is_converted_without_loading_its_remote_resources`
(`tests/test_collection_drops.py`). The 60 s timeout is unchanged.
