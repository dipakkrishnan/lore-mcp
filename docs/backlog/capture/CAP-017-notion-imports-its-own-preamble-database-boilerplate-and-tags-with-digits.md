---
id: CAP-017
title: "Bug: Notion pages import with Notion's preamble, database boilerplate and tags with digits"
priority: P1
effort: M
component: capture
status: in-review
related: [CAP-009, CAP-016, XC-055, CAP-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Verified offline on `tests/fixtures/live/notion/fetch-*.json` (R-02):
`Notion.text()` (`lore/sources.py:1278-1282`) strips tags with the regex
`</?[a-z-]+(?:\s[^>]*)?>` and nothing else, so every imported page starts
with Notion's own sentence

> Here is the result of "fetch" for the Page with URL https://… as of 2026-09-30T…:

followed by `<ancestor-2-page url=… title=…/>` left intact (a digit in the
tag name), a `<properties>{"title": …}</properties>` JSON blob turned into
bare JSON, and for a database "page" the boilerplate
`The title of this Database is: …`. The empty page (nt-06) becomes a
title-only memory only because the preamble is over 40 characters
(F-nt-02). Synthesis will quote the preamble back to the owner as their
own words; the 23-page real import is noisier than the manifest implies.

## Proposed approach

Failing tests first (in `tests/test_contract_notion.py` from `CAP-016`
if it exists, else in `tests/test_hosted.py` reading the same
recordings), then the smallest change to `Notion` that makes the owner's
words the whole memory.

### Files

- change `lore/sources.py` (`NotionFound`, `Notion.entries`,
  `Notion.text`)
- change `tests/test_contract_notion.py` (flip tests 4-6) or
  `tests/test_hosted.py`
- change `support/seed/manifest.json` only if nt-06's `expected` changes
  from `dropped`-by-title-only to `dropped` (it stays `dropped`; add to
  `why`: "preamble stripped, blank sentence is 38 chars")

### Behaviour to implement

1. `NotionFound` gains `type: str = "page"`; `entries()` yields only
   `type == "page"` (databases are structure, not the owner's words; the
   Notion-managed ones error anyway, F-nt-03). Record the skipped
   databases nowhere — they were never "found" from the owner's view —
   but make `entries()` return them in a second value? No: keep the
   signature; a comment says why.
2. `text()`:
   - drop the first line when it matches
     `^Here is the result of "fetch" for the .* as of \S+:$`
   - strip tags with `</?[a-z][a-z0-9-]*(?:\s[^>]*)?>` (digits allowed after
     the first letter)
   - drop the `<properties>…</properties>` block entirely (it is JSON of
     the title, which `Entry.title` already carries) and the
     `<iconMetadata>…</iconMetadata>` block
   - keep `<blank-page>`'s sentence as ordinary text: it is 38 characters
     and falls under the floor on its own, which is the right outcome
   - collapse three or more newlines to two
3. No change to `listing()`.

### Test design (failing first)

1. `test_text_is_the_owners_words_only` on the nt-01 recording: output
   does **not** contain `Here is the result`, `<ancestor`, `ancestor-2-page`,
   `{"title"`, or `iconMetadata`; **does** contain the canary and the
   page's first sentence (read from `support/seed/corpus/notion.json`);
   equals a new golden string.
2. `test_the_empty_page_falls_under_the_floor`: nt-06 recording →
   `len(text) < 40`, and through the stand-in (`CAP-016` test 10 shape)
   it is counted as `dropped`, not imported.
3. `test_databases_are_not_listed`: `entries(list-01.json)` → 20 entries,
   all `type == "page"` in the raw results; the 5 databases are absent.
4. `test_every_page_recording_strips_every_tag`: for all 23 `fetch-*.json`
   of pages, `re.search(r"</?[a-z][a-z0-9-]*[\s>]", text)` is `None`.
5. Existing `test_notion_pages_through_search_slowly_and_reads_page_text`
   (`test_hosted.py:190`) keeps passing; update its stub answer to the
   real shape (`{"type":"page", …}` entries; a `text` with the preamble)
   so it stops asserting a shape Notion never sends.

## Acceptance criteria

- [ ] Tests 1-4 fail before the change and pass after; test 5 passes.
- [ ] `Notion.text()` on every recorded page contains no Notion tag,
      no preamble and no properties JSON; the canaries nt-01..05 survive.
- [ ] `Notion.entries()` skips `database` results; the real list yields
      20 entries.
- [ ] `docs/connectors.md` Notion section says what is dropped (databases,
      preamble, properties) and why.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-10 (`text` on real fetch answers, databases listed, empty page
over the floor), C-16; F-nt-01 (template pages stay: they are the
owner's pages as far as Lore knows), F-nt-02, R-02.

Product decision folded in: databases are skipped rather than imported
as boilerplate. If a later item wants database rows as memories it needs
a different fetch shape anyway.

Flakiness/safety: file-only. The next live run (`XC-055`) will show
`imported` drop from 23 to the page count minus the blank page; update
`manifest.json` `real_library.notion.imported` then, not now.
