---
id: XC-053
title: Close the hygiene blind spots in the scrubber, the recordings and the corpus
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-049, XC-056, XC-048, CAP-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`support/seed/hygiene_check.py` and `tests/test_seed_hygiene.py` keep the
committed seed and recording trees free of secrets and identities, but
four things they do not check have each already bitten or nearly bitten:

- F-tool-01: a scrub rule matched `"user_id": {` and replaced the brace,
  leaving the recorded Notion tools list invalid JSON, and replaced a
  numeric `email` hit count in two `meta.json` files. The rule was fixed
  by hand; there is no regression test for brace/`null`/numeric safety.
- No test asserts that every scrubbed recording still parses (every
  `live/**/*.json` loads; every `*.xml` parses with `defusedxml`), so the
  next such rule error would be found by a contract test failing for the
  wrong reason.
- The corpus rule "every item carries exactly one canary and every public
  item carries `tidewell-seed`" is checked for uniqueness and format only
  (`test_seed_hygiene.py:160`), not for presence in each corpus file.
- `build_blog.py` must not advertise the importer feeds
  (`import/substack.xml`, `import/medium/*.html`) from `index.html`, or
  Lore's discovery would see them; nothing asserts `_Html(index).links ==
  ["/feed.xml"]`.
- `manifest.json` `real_library` blocks must name only source names and
  counts (R-12); today the rule scan would catch an email but not, say, a
  memory id or a real title.

## Proposed approach

### Files

- change `tests/test_seed_hygiene.py`
- change `support/seed/hygiene_check.py` (two new checks: parseability,
  `real_library` allowed keys)
- no change to recordings or corpus

### Test design

1. `test_a_brace_null_or_number_after_a_scrubbed_key_is_untouched`
   (F-tool-01 regression): scrub four one-line JSON documents with the
   committed rules: a `user_id` key whose value is a nested object, an
   `email` key whose value is the number zero, an `email` key whose value
   is `null`, and an `owner_id` key whose value is a twelve-character
   alphanumeric string. The first three are byte-identical after scrubbing
   and still `json.loads`; the fourth is redacted and still loads.
2. `test_every_committed_recording_still_parses`: walk
   `tests/fixtures/live/`; every `.json`/`.jsonl` line loads; every `.xml`
   parses with `defusedxml.ElementTree.fromstring`; every `.html` decodes as
   UTF-8. Add the same walk to `hygiene_check.check()` so the CLI gate
   fails on an unparseable file, and unit-test that with a temp tree
   holding `{"a": ` (exit 1, message names the file).
3. `test_every_corpus_item_carries_its_canary_once_and_public_items_the_marker`:
   for each manifest item with a `corpus_path` that is a file (or a JSON
   corpus with an id field for bluesky/substack/medium/notion), the
   item's canary occurs exactly once in that item's text and no other
   item's canary occurs in it; items whose connector is in
   `{bluesky, substack, medium, blog, notion, granola}` contain
   `tidewell-seed`. Items with `canary: null` contain no `canary-` token.
4. `test_the_built_index_advertises_only_the_public_feed`: render
   `build_blog` into a temp dir (as `test_seed_tools.py:91` does) and
   assert `lore.sources._Html(index_html).links == ["/feed.xml"]` and
   that `import/substack.xml` and `import/medium/` are not referenced
   anywhere in `index.html`.
5. `test_real_library_blocks_hold_only_names_and_counts`: every
   `sources[*].real_library` key is in an allow-list
   (`name, state, imported, connected_at, library_before, library_after,
   active_publications, canaries, note, recorded, preview, feed_headers,
   connect_label, preview_label, label, publication_title_actual,
   seeded_via, deployed_at, account, obsidian_app_registration`) and no
   string value matches `\b[0-9a-f]{32}\b` (an id) — add the check to
   `hygiene_check.py` with a unit test that a `"memory_ids": [...]` key
   fails it.

## Acceptance criteria

- [ ] Tests 1-5 exist in `tests/test_seed_hygiene.py` and pass on the
      committed trees.
- [ ] `uv run python support/seed/hygiene_check.py` exits 1 on an
      unparseable recording and on a disallowed `real_library` key
      (unit-tested with temp trees), and exits 0 on the committed trees.
- [ ] Reverting the F-tool-01 rule fix (re-widen the pattern to match a
      brace) makes test 1 fail.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-21 (import feeds unlinked; canary presence per file), W-24
(F-tool-01 regression; recordings still parse; `real_library` blocks),
C-29, C-32; R-12; F-tool-01.

Flakiness/safety: file-only; the canary walk reads the corpus, never a
recording's content for equality (recordings are scrubbed, corpus is
not, so compare canaries, not bodies).
