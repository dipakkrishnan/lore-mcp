---
id: CAP-029
title: Pin Granola's answer parsing (attribute quoting, escaped titles, dates, sections, participants)
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-009, CAP-015, CAP-024, XC-055]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

No Granola meeting answer has ever been seen (the account has no
meetings yet), so `Granola.entries`/`text` (`sources.py:1181-1210`) are
tested only through `tests/fixtures/granola.py`, whose two meetings never
exercise: an attribute value containing `>` or an escaped quote; a title
with `&amp;` (verified: `T &amp; x` stays escaped — decide whether to
unescape); a `<meeting>` without an `id` (skipped); a `date` that is not
`%b %d, %Y %I:%M %p` (falls to `_date`, then `None`); `dated` is never
asserted at all (`test_hosted.py:90` checks titles); and the three
sections' order and the ignored `known_participants` block (which carries
emails) are covered once (`:90-106`).

## Proposed approach

Unit tests with inline XML strings, in the file that owns hosted tests.

### Files

- change `tests/test_hosted.py`
- change `lore/sources.py` only for the `&amp;` decision (below)

### Decision

Titles come from an XML-ish attribute; Granola escapes `&` as `&amp;`
and `<` as `&lt;` there (ASSUMED from the `<>`-titled fixture meeting
which the stub does not escape). Unescape titles with `html.unescape`
in `entries()` so `Vet partners <> Tidewell sync` (gr-03) shows as typed.
Failing test first for that one assertion.

### Test design

1. `test_granola_entries_parse_quoted_attributes_and_skip_a_missing_id`:
   answer with three `<meeting>` rows: one with `title="Q &amp; A &gt; notes"`,
   one whose title attribute contains a `>` inside quotes, one with no
   `id` → two entries; titles `Q & A > notes` (after the decision) and the
   verbatim second; keys in order.
2. `test_granola_dates_parse_or_fall_back`: `date="Sep 30, 2026 2:15 PM"`
   → `2026-09-30`; `date="2026-09-30T14:15:00Z"` → `2026-09-30` (ISO
   prefix via `_date`); `date="yesterday"` → `None`; missing → `None`.
   Extend `:90` to assert `dated == "2026-01-02"` for `m-1`.
3. `test_granola_text_joins_the_three_sections_in_order_and_nothing_else`:
   answer with `<notes>`, `<summary>`, `<private_notes>` in that order plus
   `<known_participants>` and a `<transcript>` → text is
   `private_notes\n\nsummary\n\nnotes` (declared order, not document
   order); the participant line and the transcript are absent; a missing
   section is simply skipped.
4. `test_sec_participants_never_reach_the_memory`: the stub's
   `Owner <owner@example.com>` block → no `@` in any imported content
   (already at `:90-106`; keep, and add the same for `text()` directly).
5. `test_granola_an_empty_meeting_answer_is_nothing_found`: lister returns
   `<meetings_data count="0"></meetings_data>` → state `nothing_found`,
   `imported 0`.

## Acceptance criteria

- [ ] Tests 1-5 exist and pass; the `&amp;` assertion fails before the
      `html.unescape` change and passes after.
- [ ] `dated` is asserted for at least one stub meeting.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-09 (`entries` regex, `&amp;` decision, missing id, date parse,
`text` sections, participants), C-15; the ASSUMED XML shape (the first
live meeting in `XC-055` confirms or corrects it; if it differs, update
these tests from the recording, never the other way around).

Flakiness/safety: inline strings; the only address is the stub's
`example.com` one.
