---
id: CAP-027
title: "Bug: preview ignores the connector, so a Medium handle previews as Bluesky and hosted apps have no preview"
priority: P2
effort: S
component: capture
status: in-review
related: [STO-003, CAP-008, CAP-009, CLI-011, APP-125]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

`preview(locator, kind)` (`sources.py:1594-1596`) builds the reader from
the **kind** only: `Source.owner(locator, kind=kind).reader()`. So
`lore sources preview --feed @tidewell` resolves through
`FeedReader._handle` as a Bluesky handle, never as the Medium profile the
owner meant, and connector-specific locator rules (`MediumFeed`,
`BlueskyFeed`, `SiteFeed`'s refusals) are bypassed (R-07). There is also
no preview for the `mcp` kind at all (`cli.py:743-748` offers `--folder |
--export | --feed`), which the desktop works around by connecting and
reading. Neither gap has a test.

## Proposed approach

Failing test first, then a `connector` parameter threaded from the CLI.

### Files

- change `lore/sources.py` (`preview(locator, kind, connector=None)`)
- change `lore/cli.py` (`source_preview.add_argument("--connector")`,
  pass it through)
- change `tests/test_feed.py`, `tests/test_cli.py`
- change `docs/connectors.md` (preview accepts `--connector`; no preview
  for signed-in apps, use `sources read`)

### Behaviour

`preview(locator, kind, connector)` → `Source.owner(locator, kind=kind,
connector=connector).reader()`; the kind/connector mismatch rule
(`:117-119`) applies, so `--feed --connector obsidian` is a
`SourceError`. The `mcp` kind stays without a preview; the CLI's help for
`preview` says so.

### Test design (failing first)

1. `test_preview_with_a_connector_uses_that_connectors_locator_rules`:
   `serving({"medium.com/feed/@tidewell": "medium.xml", "getAuthorFeed":
   "bluesky.json"})`; `preview("@tidewell", "feed", connector="medium")`
   asks `https://medium.com/feed/@tidewell` and reports the Medium fixture's
   count and label `@tidewell`; without a connector it asks the Bluesky
   URL (pin the old behaviour as the default; it is what `add --feed` does).
2. `test_preview_refuses_a_handle_for_a_site_connector`:
   `preview("@name", "feed", connector="substack")` → `SourceError("Enter
   the site's address, as your browser shows it")` before any fetch (the
   `serving` stub records zero calls).
3. `test_cli_preview_accepts_connector_and_still_writes_nothing`:
   `cli.main(["sources","preview","--feed","@tidewell","--connector",
   "medium","--json"])` → JSON with `label "@tidewell"`, and
   `Registry(store).owned == []` afterwards.
4. `test_cli_preview_has_no_mcp_flag`: `cli.main(["sources","preview",
   "--mcp","granola"])` exits 2 with argparse's usage error (captured
   stderr contains `--folder/--export/--feed`); the docstring states the
   gap and points to `sources read`.

## Acceptance criteria

- [ ] Tests 1-2 fail before the change and pass after; tests 3-4 pass.
- [ ] `lore sources preview --help` documents `--connector` and says
      signed-in apps have no preview.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-12 (connector-aware preview; no `mcp` preview documented),
C-20 `preview`, C-23; R-07.

Flakiness/safety: `serving()` stub only. The desktop does not call
`preview` today (`state.cjs` has no such function), so no Node change.
