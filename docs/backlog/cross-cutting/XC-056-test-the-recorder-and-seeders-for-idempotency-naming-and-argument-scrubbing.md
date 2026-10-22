---
id: XC-056
title: Test the recorder and seeders for idempotency, file naming and argument scrubbing
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-053, XC-049, XC-054]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`support/seed/record.py` and the two seeders are the only way recordings
and remote seed content come into being, and three of their behaviours
were found the hard way with no test since:

- F-md-03: `record.py feed` names the file after the handle
  (`slug()`, `record.py:103-106`), which put a handle into a committed
  filename; it was renamed to `01-feed.xml` by hand. The naming rule is
  unpinned, so the next recording repeats it.
- `meta.json` scrubs `url_or_tool` but not `arguments`
  (`record.py:68-78`), so Notion page ids sit in `meta.json` and in
  `fetch-<id>.json` filenames. The workspace is fictional, so this is
  tolerated (R-12), but the decision is recorded nowhere a test can hold
  it to.
- Re-running `seed_bluesky.py` or `seed_notion.py` creates every record
  again: there is no dedupe by canary and no refusal when `remote.id` is
  already set in the manifest, so a careless rerun doubles the seed
  account's posts and breaks every expected count.
- `record.py obsidian` (`record_obsidian`, `:260-274`, a subprocess
  `sources choices`) has no test at all.

## Proposed approach

### Files

- change `support/seed/record.py`: `slug()` for feeds returns a fixed
  stem (`01-feed`, `01-index`, `02-feed` by fetch order and type, never
  the handle or host); `Recording.keep` scrubs `arguments` with the same
  rules as `url_or_tool`
- change `support/seed/seed_bluesky.py`, `support/seed/seed_notion.py`:
  refuse (exit 1, message names the item id) when any item to create
  already has a non-null `remote.id`, unless `--again` is passed; `--dry-run`
  reports the refusal too
- change `tests/test_seed_tools.py`

### Test design (`tests/test_seed_tools.py`, all against local stubs)

1. `test_feed_recordings_are_named_by_order_and_type_never_by_handle`:
   record the corpus blog from `http.server` (as `:160` does) and assert
   the files are exactly `01-index.html`, `02-feed.xml`, `meta.json`;
   record a stub Bluesky page (route the handle to a fixture) and assert
   `01-feed.json`, with no part of the handle in any filename.
2. `test_meta_arguments_are_scrubbed_like_urls`: run `record_hosted`
   against the Granola stub with an argument containing an email-shaped
   string and assert `meta.json` `arguments` holds `redacted@example.com`
   and `scrub_hits` counts it.
3. `test_a_seeder_refuses_to_recreate_an_item_that_already_has_a_remote_id`:
   copy the manifest to a temp path, set `remote.id` on `bs-01`, run the
   Bluesky seeder against the stub HTTP server: exit 1, zero `createRecord`
   requests, message contains `bs-01`; with `--again` it proceeds. Same for
   `nt-01` with the Notion seeder.
4. `test_record_obsidian_copies_the_app_file_scrubbed_and_the_choices`:
   temp `OBSIDIAN_HOME` with an `obsidian.json` whose vault path is under a
   fake macOS home directory for an invented user name (the shape the
   `home-path` scrub rule matches); run `record_obsidian(raw, out, rules)`;
   assert `out/obsidian/obsidian.json` has that prefix rewritten to the
   scrubber's `owner` home, and
   `out/obsidian/choices.json` is the parsed `sources choices obsidian
   --json` output (one vault, `open: true`). The subprocess runs
   `sys.executable -m lore.cli` with `LORE_HOME` from `LoreTestCase`.

## Acceptance criteria

- [ ] Tests 1-4 exist and pass; the committed recordings' filenames already
      satisfy rule 1 (no rename needed), asserted by a walk over
      `tests/fixtures/live/*/meta.json` `file` fields.
- [ ] Both seeders refuse a rerun over an item with `remote.id` set and
      accept `--again`; `--dry-run` shows the refusal without a request.
- [ ] `meta.json` `arguments` pass the scrub rules; `hygiene_check.py`
      stays green on the committed tree.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`, which include
      `support/seed`) pass.

## Notes

Covers: W-22 (idempotency guard), W-23 (`record_obsidian`, filename
leak, `arguments` scrub), C-30, C-31; F-md-03, R-12.

Flakiness/safety: seeders are driven against the same 127.0.0.1 stub
`test_seed_tools.py:219-392` already uses; the fake password/token
come from env vars set by the test; nothing reaches Bluesky or Notion.
The Medium ten-story rollover (md-05..11) is *not* in scope; it needs
publishing on the seed account and belongs to a future live decision
noted in `XC-054`.
