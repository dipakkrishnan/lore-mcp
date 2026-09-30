---
id: CAP-028
title: "Readwise: a contract stand-in from the published tool schema; live stays blocked on a paid plan"
priority: P3
effort: S
component: capture
status: in-review
related: [CAP-009, CAP-015, CAP-016, XC-050, XC-055]
blockers: []
dependencies: ["Readwise's published MCP tool schema for reader_list_documents and reader_get_document_highlights (docs or a one-off list_tools from a paid account)"]
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Readwise was not seeded (paid plan) so everything vendor-side is ASSUMED
from code (`sources.py:1285-1318`): tool names
`reader_list_documents` / `reader_get_document_highlights`, arguments
`{"limit": 100, "response_fields": [...], "page_cursor"}` and
`{"document_id"}`, answers with `results[]`, `nextPageCursor`, highlight
`content|text` and `note`. `tests/test_hosted.py:253` tests the parser
against synthetic answers only (R-13). The Granola drift (F-gr-01) shows
what an unverified argument shape costs.

## Proposed approach

Two steps, the second gated on the dependency.

1. Now: a `tests/fixtures/live/readwise/tools-schema.json` **placeholder
   policy** — do not invent one. Instead add the parser gaps as unit tests
   and a `RecordedHosted("readwise")`-shaped stand-in (`XC-050`) fed by an
   inline synthetic folder in the test's temp dir, so the plumbing exists
   the day a real schema is recorded.
2. When the schema is obtained (docs page or a `list_tools` from someone's
   paid account, run through `record.py hosted readwise` after adding
   `readwise` to its `choices`): commit `tools-schema.json` (names and
   input schemas only, like Granola's) and add the two `jsonschema`
   validation tests mirroring `CAP-015` test 1.

### Files

- change `tests/test_hosted.py`
- change `support/seed/record.py` (`hosted.add_argument("app",
  choices=[..., "readwise"])`)
- later: add `tests/fixtures/live/readwise/tools-schema.json`,
  `tests/test_contract_readwise.py`

### Test design (now)

1. `test_readwise_a_document_without_highlights_is_dropped`: listing of
   two documents; highlights answer `{"results": []}` for one and one
   highlight for the other → `imported 1`; the empty one is found, not
   kept (floor), `errors 0`.
2. `test_readwise_paging_follows_next_page_cursor`: first answer has
   `nextPageCursor: "c2"` → second call's arguments contain
   `page_cursor: "c2"`; a `null` cursor stops.
3. `test_readwise_listing_arguments_are_stable`: `Readwise().listing(None)
   == {"limit": 100, "response_fields": ["title", "saved_at"]}` and with a
   cursor adds `page_cursor` — pinned so a later schema test has a fixed
   input to validate.
4. `test_the_catalog_offers_readwise_as_a_sign_in` already exists
   (`:183`); assert also that its `guide`/`placeholder` mention nothing
   to type.

### Test design (later, contract)

5. `jsonschema.validate(Readwise().listing(None), schema["reader_list_documents"])`
   and `validate(Readwise().reading("doc-1"), schema["reader_get_document_highlights"])`.

## Acceptance criteria

- [ ] Tests 1-4 exist and pass with an inline stub; no schema is invented.
- [ ] `record.py hosted readwise` is accepted by the argument parser
      (tested in `test_seed_tools.py` with a dry argument parse).
- [ ] `## Notes` records where the schema will come from and that the
      live tier stays out of scope until a plan exists.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-11 (all rows; the contract row lands with the dependency),
C-17; R-13.

Flakiness/safety: in-process stub only. The live tier for Readwise is
explicitly not planned; it needs a paid subscription the project does not
hold.
