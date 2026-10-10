---
id: CAP-015
title: "Bug: Granola rejects Lore's list_meetings arguments; commit the fix and make the stand-in honour the recorded schema"
priority: P0
effort: S
component: capture
status: in-review
related: [CAP-009, XC-050, XC-055, CAP-029, CAP-024, XC-048]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Granola's hosted server now accepts only
`time_range ∈ {this_week, last_week, last_30_days}` with
`additionalProperties: false` (recorded in
`tests/fixtures/live/granola/tools-schema.json`; F-gr-01, R-01). Lore sends
`{"time_range": "custom", "custom_start": …, "custom_end": …}` and every
Granola read fails as `unreachable`. A one-line fix
(`Granola.listing` → `{"time_range": "last_30_days"}`) sits **uncommitted**
in `lore/sources.py:1178-1179` of the `chore-seed-connectors` worktree.

The suite did not catch the drift and would not catch a regression:
`tests/fixtures/granola.py:31-35` still declares
`list_meetings(time_range, custom_start, custom_end)`, so the stub accepts
the old, broken arguments. Nothing validates `listing()`/`reading()`
against the vendor's schema, and the stub's meeting ids (`m-1`) are not
UUIDs as `get_meetings` requires (`format: uuid`, `minItems 1, maxItems 10`).

## Proposed approach

Failing test first, then the fix, then the stub.

### Files

- change `lore/sources.py` (commit the `listing` change; nothing else)
- change `tests/fixtures/granola.py`
- change `tests/test_hosted.py`
- change `pyproject.toml` if `XC-048` has not yet added `jsonschema` to
  the dev group (add it here; the two items may land in either order)

### Test design (`tests/test_hosted.py`)

1. `test_contract_granola_asks_only_what_its_server_accepts` — load
   `tests/fixtures/live/granola/tools-schema.json`;
   `jsonschema.validate(Granola().listing(None), tools["list_meetings"],
   format_checker=FormatChecker())` raises nothing;
   `jsonschema.validate(Granola().reading("6f0c2a3e-1b4d-4c5e-9a7f-0123456789ab"),
   tools["get_meetings"], format_checker=FormatChecker())` raises nothing.
   **Written first, against the committed code, it must fail with a
   `ValidationError` naming `custom_start`** (additional property).
2. `test_the_stand_in_refuses_what_granola_refuses` — through
   `Client(Granola().server)`, `call_tool("list_meetings",
   {"time_range": "custom", "custom_start": "2000-01-01", "custom_end":
   "2026-09-30"})` answers `is_error=True`; `{"time_range":
   "last_30_days"}` answers the meetings XML; `{"time_range": "yesterday"}`
   is an error (enum).
3. `test_the_stand_in_schema_matches_the_recording` — the stub's
   `list_tools()` `inputSchema` for `list_meetings` and `get_meetings`
   equals the recorded schema after dropping `$schema` and `description`
   keys (so a future vendor change is a one-place edit that fails here
   until the stub follows).
4. Existing Granola tests keep passing with UUID meeting ids: change
   `MEETINGS` keys to two fixed UUIDs and update
   `test_meetings_import_as_private_memories_with_their_titles_and_days`
   (`:90`) and `test_a_sync_reads_only_what_it_has_not_kept` (`:108`)
   where they reference `m-1`/`m-2`.

### Stub change (`tests/fixtures/granola.py`)

```python
@self.server.tool()
def list_meetings(time_range: Literal["this_week", "last_week", "last_30_days"] = "last_30_days") -> str: ...

@self.server.tool()
def get_meetings(meeting_ids: list[str]) -> str:   # validate 1..10 items, each uuid.UUID(...) parses; else raise ValueError
```

The SDK derives the input schema from the signature and rejects unknown
arguments; verify with test 2 that it does (if the SDK is permissive,
validate inside the handler with `jsonschema` against the recorded file
and return an error). The desktop edge scenario
(`app/desktop/support/edge.sh:84`) runs this file over HTTP; re-run
`support/edge.sh connectors` locally once.

## Acceptance criteria

- [ ] Test 1 fails on `main` (before the `listing` change) and passes
      after it; the commit message for the fix cites F-gr-01.
- [ ] `lore/sources.py` `Granola.listing` returns `{"time_range":
      "last_30_days"}` and nothing else changes in `lore/`.
- [ ] `tests/fixtures/granola.py` no longer accepts `custom_start`/
      `custom_end`, uses UUID meeting ids, and its `list_meetings`/
      `get_meetings` input schemas equal the recording (test 3).
- [ ] `support/edge.sh connectors` still passes locally (the stub is its
      Granola).
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-09 (schema contract for `listing`/`reading`; stub drift),
C-15, C-33; F-gr-01, F-gr-04, R-01.

Known consequence to record in `docs/connectors.md`: `last_30_days` means
meetings older than 30 days are never importable through Lore (the free
plan shows 30 days anyway); `get_meetings` allows 10 ids per call and Lore
sends one (`CAP-024` measures it). Both are decisions, not part of this
fix.

Flakiness/safety: in-process stub and a committed schema file; no
network.
