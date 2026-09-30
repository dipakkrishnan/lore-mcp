---
id: CAP-026
title: Test the registry lifecycle gaps (state after a failed read, upstream removal, feed replace, reads record cleanup)
priority: P2
effort: S
component: capture
status: in-review
related: [STO-003, CAP-023, CLI-011, APP-128]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`Registry` (`sources.py:1384-1578`) is well covered for add/replace/
remove, but four of its promises are only implied:

- `entries()` shows the **last read's** state, not a fresh probe
  (`:1415-1420`, `:1570-1572`): a source whose read failed keeps showing
  that failure until re-read. `test_hosted.py:127` reaches it through
  `read`; nothing calls `entries()` after a failure without re-probing.
- An item that disappears upstream (a feed window rolled, a meeting
  deleted, a note removed from the vault) is **not** removed and there is
  no `removed` stat; the memory persists. Undocumented.
- Replacing a feed exists only through the CLI (`--replace NAME`; the
  desktop offers "Connect another" for feeds, `renderer.js:1057`) and has
  no test; hosted replace on the same server is tested (`:153`).
- `remove` drops the `source_reads` record (`:1525`); tests assert the
  owned list only.

## Proposed approach

Component tests in `tests/test_sources.py` and `tests/test_feed.py`
against existing stubs.

### Files

- change `tests/test_sources.py`, `tests/test_feed.py`

### Test design

1. `test_entries_report_the_last_read_not_a_fresh_probe`: add a folder
   source, then make it unreadable (`chmod 000`, skipped on root/Windows)
   and `read` → state `needs_permission`; restore permissions **without**
   reading again → `entries()` still says `needs_permission` and
   `last_read_at` is unchanged; `read` again → `connected`.
2. `test_an_item_gone_upstream_stays_in_the_library`: feed with three
   items, read; feed now with two → `read` reports `added 0, updated 0,
   unchanged 2`, `Store.source_counts` still 3, no `removed` key in the
   read dict (pin the absence; docstring says a removal stat is a product
   decision).
3. `test_replacing_a_feed_reads_the_new_place_first`: `add` feed A (3
   items), `Registry.connect("blog", B, replacing=name_A)` where B is
   unreachable → `SourceError`, A untouched; where B works (2 items) → A's
   record gone, B present, memory count 5 (A's kept, `delete=False`),
   `source_reads` has B only.
4. `test_removing_a_source_drops_its_read_record`: after `remove`, the
   `source_reads` setting has no entry for the name and `entries()` does
   not list it; `read(name)` now raises `SourceError` (unknown name).
5. `test_a_hosted_replace_on_the_same_server_is_a_read` — already at
   `test_hosted.py:153`; add the assertion that `source_reads` has one
   record and `last_read_at` advanced.
6. `test_an_export_read_by_sync_is_unchanged_and_never_refreshed`: export
   connected, `sync` names include it, `read` → all `unchanged`, catalog
   `refresh` is False (extends `test_export.py:159`).

## Acceptance criteria

- [ ] Tests 1-6 exist and pass; test 1 is skipped when the process can
      read a `chmod 000` directory (root).
- [ ] The docstrings of tests 2 and 6 state the pinned behaviour and name
      this item.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-14 (`LastRead.state`; upstream-removed item; export re-read),
W-15 (CLI feed replace), W-16 (`source_reads` cleanup), W-18 (`sync` on
an export), C-01, C-19, C-25.

Flakiness/safety: temp dirs, `serving()` stubs; permission changes are
restored in `addCleanup`.
