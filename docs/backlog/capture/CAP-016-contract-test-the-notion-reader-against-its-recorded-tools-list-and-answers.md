---
id: CAP-016
title: Contract-test the Notion reader against its recorded tool list, list page and fetch answers
priority: P1
effort: M
component: capture
status: in-review
related: [CAP-009, CAP-017, XC-050, XC-055, XC-048, CAP-024]
blockers: [XC-048]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`tests/fixtures/live/notion/` holds the real tool list (45 tools with
input schemas), one search page (25 results, `next_cursor` null), 23
fetch answers, 2 error answers (`restricted_resource` 403 for
Notion-managed databases, F-nt-03) and `tool-access.json`. No test reads
any of it. `tests/test_hosted.py:190-252` exercises `Notion` against a
hand-written stub whose answers were guessed from the docs, and the only
error case (`:231`) uses a synthetic `PermissionError`, not the body Notion
actually sends. So the suite cannot tell whether `Notion.listing()` still
matches `notion-search`'s schema, whether `entries()` reads the real list
shape, or whether `text()` handles a real page.

## Proposed approach

One contract file that reads the recordings directly (no network, no
stub) plus one component test that replays the error bodies through the
recorded stand-in from `XC-050` when it exists (fall back to a minimal
inline `MCPServer` otherwise).

### Files

- add `tests/test_contract_notion.py`
- change `tests/test_hosted.py` (the error-replay component test)

### Test design (`tests/test_contract_notion.py`)

Load once in `setUpClass`: `tools = {t["name"]: t for t in
tools-list.json["tools"]}`, `listing = list-01.json`, every
`fetch-*.json`, every `fetch-*.error.json`, `meta.json`.

1. `test_listing_and_reading_validate_against_the_recorded_input_schemas`:
   `jsonschema.validate(Notion().listing(None), tools["notion-search"]["inputSchema"])`
   and with a cursor `"abc"`; `validate(Notion().reading("<id>"),
   tools["notion-fetch"]["inputSchema"])`. Also assert `page_size` (25) does
   not exceed the schema's `maximum` if one is declared, and that the
   filter key path `filters.created_date_range.start_date` exists in the
   schema's `properties` tree.
2. `test_the_tools_lore_needs_are_offered`: `{"notion-search",
   "notion-fetch"} <= tools.keys()`; record the count (45) in the
   assertion message rather than pinning it.
3. `test_entries_read_the_recorded_list_page`: `Notion().entries(text of
   list-01.json)` → 25 entries, cursor `None`; every entry key is a UUID
   with hyphens; `dated` for the first entry equals the ISO date prefix of
   its `timestamp` (`2026-09-30`); titles are non-empty for all 25.
4. `test_databases_are_listed_alongside_pages` (pin, decided by
   `CAP-017`): the raw `results[*].type` values are `{"page", "database"}`
   with 20 pages and 5 databases; today `entries()` returns all 25. Mark
   the assertion with a comment pointing at `CAP-017`, which changes it.
5. `test_text_on_a_recorded_page_pins_todays_output`: for the nt-01 page
   (`fetch-3eb0431b-8ba8-81ee-b4b0-d3a734f259aa.json`), `Notion().text()`
   output is stored as a golden string in the test; assert equality.
   Assert three properties of it explicitly so the bug is visible:
   it starts with `Here is the result of "fetch"` (preamble left in), it
   contains `<ancestor-2-page` (digit tag survives), and it contains the
   canary `canary-notion-01`. `CAP-017` flips the first two assertions.
6. `test_text_on_the_empty_page_is_over_the_floor_only_because_of_the_preamble`
   (F-nt-02): `fetch-3eb0431b-8ba8-8131-af6d-eb89b967c480.json` →
   `len(text) >= 40` today and the text without the preamble line is
   `This page is blank and has no content.` (38 chars) → would be dropped.
7. `test_a_database_fetch_is_boilerplate`: any `fetch-*.json` whose
   listing `type` is `database` produces text starting with
   `The title of this Database is` (verify against the recording; if none
   of the 23 is a database, skip with a message).
8. `test_every_recorded_fetch_parses_and_keeps_its_canary`: for the ids of
   nt-01..05 (from `manifest.json` `remote.id`), `text()` contains that
   item's canary; nt-03's text contains the reserved phone number
   verbatim (Lore does not scrub imports; the persona value is
   allow-listed by the scrubber).
9. `test_the_error_bodies_are_what_the_reader_treats_as_lookup_errors`:
   both `.error.json` files have `is_error: true` and text containing
   `restricted_resource`; nothing more is asserted here — the behaviour is
   test 10.

`tests/test_hosted.py`

10. `test_a_recorded_notion_refusal_is_skipped_and_counted`: stand-in
    (`RecordedHosted("notion")` from `XC-050`, or an inline stub whose
    fetcher returns the recorded error text with `is_error=True` for two
    ids and a recorded page for one) → `Registry.connect("notion", …)`:
    `imported 1`, `errors 2`, state `connected`; `read` again fetches
    nothing.

## Acceptance criteria

- [ ] `tests/test_contract_notion.py` exists, reads only
      `tests/fixtures/live/notion/**`, and covers tests 1-9.
- [ ] `listing()`/`reading()` validate against the recorded schemas
      (a deliberate `page_size: "25"` string makes test 1 fail).
- [ ] The two recorded error bodies drive test 10 and the read continues
      past them with `errors == 2`.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-10 (schema contract, `entries` on the real list, `text` on real
fetches, error answer replay, databases listed, empty page over the
floor), C-13 `_read`/`_call`, C-16; F-nt-02, F-nt-03, R-02, R-03.

Flakiness/safety: file-only. The golden string in test 5 is ~1 KB of
fictional content; keep it in the test, not a new fixture, so the
recording stays the single source.

Sequencing: blocked by `XC-048` (file prefix, `jsonschema` dev
dependency). `CAP-017` (the fix) updates tests 4, 5 and 6; write them so
that flip is a small diff.
