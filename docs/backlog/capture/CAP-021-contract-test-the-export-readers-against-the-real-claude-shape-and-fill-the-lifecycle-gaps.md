---
id: CAP-021
title: Contract-test the export readers against the real Claude shape and fill the export lifecycle gaps
priority: P1
effort: M
component: capture
status: in-review
related: [CAP-006, XC-051, XC-048, CAP-026]
blockers: [XC-048]
dependencies: ["A real ChatGPT export recorded with `record.py export-shape` into tests/fixtures/live/exports/chatgpt/real-shape.json (not yet received from OpenAI)"]
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`tests/fixtures/live/exports/claude/real-shape.json` inventories the real
Claude export's key paths and value types (never values); no test reads
it, so a rename of `chat_messages`, `sender`, `text` or `created_at` would
be found by an owner. The real export also showed what the parser
ignores: `content[]` blocks and `attachments[].extracted_content` are
never read, which is why cl-03 (text empty, words only in `content[]`) is
dropped and why 1 of the 12 real drops had its words only in an
attachment (F-cl-01). Claude's download is five zips, of which only
`conversations.json` matters, and it may arrive loose (F-cx-01); the
suite has one `empty.zip` case (`test_export.py:168`) and no "the other
four archives" case, no "newer export with one extra conversation" case,
and no ChatGPT real-shape at all (R-10).

## Proposed approach

### Files

- add `tests/test_contract_exports.py`
- change `tests/test_export.py` (lifecycle gaps)
- later, when the ChatGPT shape exists: add its cases to the same
  contract file (tracked by the dependency; the file is written so a
  missing `chatgpt/real-shape.json` skips those tests with a message)

### Test design (`tests/test_contract_exports.py`)

Helper `paths(shape) -> set[str]` flattens the shape inventory to dotted
paths with `[]` for arrays and `<id>` for folded keys (the format
`record.py shape` writes; see `test_seed_tools.py:145`).

1. `test_every_path_the_claude_parser_reads_exists_in_the_real_shape`:
   derive the paths from the models: `Conversation` fields/aliases
   (`name`, `created_at`, `chat_messages`) and `Turn` aliases (`sender`,
   `text`, `created_at`) → each must be in `paths(real-shape)` with the
   expected type (`str`, `list`).
2. `test_the_real_shape_carries_what_the_parser_ignores`:
   `chat_messages[].content[]`, `chat_messages[].attachments[].extracted_content`
   exist in the shape; the test docstring names F-cl-01 so the gap is
   deliberate, not forgotten.
3. `test_new_top_level_keys_are_reported_not_failed`: keys in the shape
   that no model reads are listed in the assertion message (informational,
   always passes) — a cheap drift log.
4. `test_the_chatgpt_shape_when_recorded`: `skipUnless` the file exists;
   same as 1 for `mapping.<id>.message.author.role`,
   `…content.parts[]`, `…create_time`, `current_node`, `…parent`.

`tests/test_export.py`

5. `test_a_content_only_message_is_lost` (cl-03 as a unit): a Claude
   conversation whose only human message has `"text": ""` and
   `"content": [{"type":"text","text": "<40+ chars>"}]` → not kept; the
   docstring points at F-cl-01 and says this pins current behaviour.
6. `test_the_other_four_claude_archives_are_refused_by_name`: build
   `projects.zip` (member `projects.json`), `memories.zip`, `frames.zip`,
   `light_metadata.zip` with plausible member names and no
   `conversations.json` → each is `unreachable` with the message
   `That file isn't a Claude export.` via `connect claude`; a loose
   `conversations.json` next to them is accepted.
7. `test_a_newer_export_adds_only_the_new_conversation`: zip A with two
   conversations, zip B = A plus one; `connect claude A` → imported 2;
   `connect claude B` (same name `claude-export`, locator updated) →
   `added 1, unchanged 2`; memory count 3, no duplicate keys
   (`Store.source_keys`).
8. `test_an_attachment_only_conversation_is_found_not_kept`: human turn
   with short `text` and an `attachments[0].extracted_content` of 500
   chars → counted found, not kept (the 82-of-94 rule accounting).
9. `test_a_conversation_with_no_messages_is_found_not_kept` if not already
   covered by `:195` (`Empty` conv) — extend that test's assertions to
   check `found` vs `kept` counts explicitly.

## Acceptance criteria

- [ ] `tests/test_contract_exports.py` reads only
      `tests/fixtures/live/exports/**` and passes; renaming
      `chat_messages` in the shape file fails test 1.
- [ ] Tests 5-9 exist in `tests/test_export.py` and pass; the five-archive
      case asserts the product-specific refusal text.
- [ ] The ChatGPT contract test is present and skipped with a message
      naming the missing file.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-03 (real-shape contract, pending recording), W-04 (Claude
aliases vs real shape, cl-03 unit, five-zip layout, 82-of-94 accounting),
W-18 (newer export adds only new; `refresh False` covered by
`test_sources.py:511`), C-07, C-08; F-cl-01, F-cx-01, R-10.

Flakiness/safety: no real export content is ever committed; the shape
file holds paths and types only (`record.py export-shape` guarantees it,
`test_seed_tools.py:145`). Synthetic zips are built in the temp dir with
fixed timestamps as `build_exports.py` does.

Sequencing: blocked by `XC-048` (file prefix). The ChatGPT half waits on
the dependency; the item is still shippable without it.
