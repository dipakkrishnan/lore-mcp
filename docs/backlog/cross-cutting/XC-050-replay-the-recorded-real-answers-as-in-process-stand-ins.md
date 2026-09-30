---
id: XC-050
title: Replay the recorded real answers as in-process feed and hosted stand-ins
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [XC-048, CAP-016, CAP-018, CAP-019, XC-051, APP-179, CAP-015]
blockers: [XC-048]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The recordings under `tests/fixtures/live/` are exactly what Lore saw
(`record.py` tees `FeedReader.fetch` and `HostedReader._run`), but the
suite can only stub a feed by URL fragment (`serving()` in
`tests/test_feed.py:28`) with hand-trimmed files under `fixtures/feeds/`,
and can only stub a hosted app through `tests/fixtures/granola.py`, which
invents its own answers. There is no way to say "run the Notion reader
against the 25-entry list and 23 fetches that were recorded on 2026-09-30"
or "serve the recorded Bluesky page to the desktop edge walk". Each
contract test (CAP-016/018/019) and the edge extension (APP-179) would
otherwise re-implement that plumbing.

## Proposed approach

One module, `tests/fixtures/replay.py`, that turns a recording folder into
the two stand-ins the suite already knows how to use.

### Files

- add `tests/fixtures/replay.py`
- add `tests/test_replay.py` (component tests of the module itself)
- change `tests/fixtures/granola.py` only to import shared helpers if
  duplication appears; its behaviour is `CAP-015`'s concern

### API

```python
def recorded_feed(connector: str) -> ContextManager        # patches FeedReader.fetch
class RecordedHosted:                                      # an MCPServer built from a folder
    def __init__(self, connector: str) -> None
    server: MCPServer
    calls: list[tuple[str, dict]]                          # every (tool, arguments) seen
def serve_hosted(connector: str, port: int) -> None        # `python tests/fixtures/replay.py notion PORT`
```

- `recorded_feed(c)` reads `tests/fixtures/live/<c>/meta.json` and maps
  each `requests[n].url_or_tool` to `requests[n].file`; the patched
  `fetch(url)` answers the file's bytes on an exact URL match, and raises
  `urllib.error.HTTPError(url, 404, …)` otherwise (so discovery guesses
  behave as they did live). The locator the test should use is
  `meta["locator"]`.
- `RecordedHosted(c)` registers two tools named after
  `Connector.named(c).lister` / `.fetcher`. The lister answers
  `list-01.<txt|json>` (and `list-02…` when a cursor is requested, if
  present); the fetcher looks up `fetch-<key>.*`; a `fetch-<key>.error.json`
  answers `is_error=True` with the recorded `text`. Tool input schemas are
  taken verbatim from `tools-list.json` / `tools-schema.json` when present
  so that the stand-in **rejects** arguments the vendor rejects (this is
  what the old Granola stub failed to do). Use `MCPServer.tool()` with an
  explicit input schema, or validate arguments with `jsonschema` inside
  the handler and answer `is_error` on failure.
- `serve_hosted` runs the server on `streamable-http` for the desktop edge
  walk (`APP-179`), like `granola.py` does today.

### Test design (`tests/test_replay.py`)

1. `test_a_recorded_feed_answers_only_its_recorded_urls`: with
   `recorded_feed("blog")`, `FeedReader.fetch(meta.locator)` returns the
   bytes of `01-index.html` (sha256 equal to the file), and an unrecorded
   URL raises `HTTPError` 404.
2. `test_a_recorded_hosted_app_lists_and_fetches_what_was_recorded`:
   `RecordedHosted("notion")` through `Client(server)`: `list_tools()`
   offers `notion-search` and `notion-fetch`; calling the lister with
   `Notion().listing(None)` returns the text of `list-01.json`; calling
   the fetcher with one recorded id returns that file; with an `.error`
   id returns `is_error=True`.
3. `test_the_stand_in_refuses_what_the_vendor_refuses`:
   `RecordedHosted("granola")` called with
   `{"time_range": "custom", "custom_start": "2000-01-01"}` answers
   `is_error=True` (schema has `additionalProperties: false`), and with
   `{"time_range": "last_30_days"}` does not.
4. `test_every_call_is_remembered`: `calls` lists `(tool, arguments)` in
   order, so contract tests can assert request shapes.

## Acceptance criteria

- [ ] `tests/fixtures/replay.py` provides `recorded_feed`, `RecordedHosted`
      and `serve_hosted` as specified; `tests/test_replay.py` passes.
- [ ] A hosted stand-in built from `tests/fixtures/live/granola/tools-schema.json`
      rejects `custom_start`/`custom_end` and accepts `last_30_days`.
- [ ] No test reads the network; the module never writes under
      `tests/fixtures/`.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: C-31 (recordings become executable), C-33 (generalises the
Granola stand-in), R-03 (drift surface gets a replay path); used by
CAP-016, CAP-018, CAP-019, XC-051, APP-179.

Flakiness/safety: pure file I/O and in-process MCP; the HTTP mode binds
`127.0.0.1:PORT` only when invoked as a script.

Sequencing: blocked by `XC-048` (needs the explicit `jsonschema` dev
dependency and the level names for the docs). `CAP-015` is not blocked on
this: it fixes `granola.py` directly and this module may later reuse it.
