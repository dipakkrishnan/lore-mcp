---
id: CLI-010
title: Drive `sources connect`, `catalog` and `choices` through `cli.main` for every app provable offline
priority: P1
effort: M
component: cli-ux
status: in-review
related: [CLI-002, XC-051, XC-048, CLI-011, CAP-020, XC-057]
blockers: [XC-048]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

No Python test drives `cli.main(["sources", "connect", <app>, ...])`
(verified: `test_sources.py:460` uses `Registry.connect`; the real CLI is
exercised only from `app/desktop/test/app.test.cjs:824-845` and the
Electron edge walk, both on macOS runners only). `tests/test_cli.py:124-128`
parses the `catalog`/`choices` arguments and stops. So the JSON row the
desktop parses, the text line `● <label> connected · N imported`, the
`lore: <msg>` + exit 2 contract, `--replace`, and the `catalog --json`
shape are unasserted on Linux CI, where `python-unit` runs.

## Proposed approach

One e2e file under the `XC-048` naming rule, in-process (`cli.main` with
`captured()`), with stand-ins for every network.

### Files

- add `tests/test_e2e_sources_connect.py`

### Stand-ins

- obsidian: temp vault (three notes, one under 40 chars)
- chatgpt / claude: `tests/fixtures/exports/<product>/conversations.json`
  zipped into the temp dir (`ExportTest.zipped` shape)
- substack / medium / bluesky / blog: `serving()` from `test_feed.py`
  with `substack.xml`, `medium.xml`, `bluesky.json`, `rss.xml` routed by
  fragment
- granola: `serving(Granola().server)` + `HostedReader.sign_in` patched to
  return True without calling `show` (the approval line itself is
  `XC-057`)

### Test design

1. `test_catalog_json_is_the_app_models_and_text_is_id_and_what`:
   `cli.main(["sources","catalog","--json"])` → list of 10 dicts equal to
   `[app.model_dump() for app in Connector.catalog()]` in order
   (`obsidian, chatgpt, claude, substack, medium, bluesky, blog, granola,
   notion, readwise`); text form has one line per app matching
   `^  \S+\s+.+$`.
2. `test_connect_each_app_returns_the_row_the_desktop_parses`: for each of
   the eight offline apps, `connect <app> <locator> --json` exits 0 and
   prints exactly one JSON line with keys `{name, label, kind, locator,
   owned, connector, refresh, enabled, imported, state, last_read_at}`;
   `name` starts with `<app>-` (or is `<app>-export`), `connector == app`,
   `state == "connected"`, `imported` equals the fixture's kept count
   (obsidian 2, chatgpt and claude per `test_export.py`, substack/medium/
   bluesky/blog per `test_feed.py`, granola 2).
3. `test_connect_text_form`: `connect obsidian <vault>` without `--json`
   prints `  ● <label padded> connected · 2 imported`.
4. `test_a_bad_locator_is_one_lore_line_and_exit_2`: `connect substack
   @handle` → exit 2, stderr exactly `lore: Enter the site's address, as
   your browser shows it\n`, stdout empty; `connect bluesky https://x`
   → the Bluesky refusal; `connect evernote x` → `lore: unknown app:
   evernote`; `connect obsidian /gone` → `lore: can't reach gone`.
5. `test_replace_reads_the_new_place_first`: `connect obsidian A`, then
   `connect obsidian /gone --replace <nameA>` → exit 2, A still listed;
   `connect obsidian B --replace <nameA>` → B's row, `sources list --json`
   has one obsidian source.
6. `test_the_same_place_twice_is_one_source`: `connect blog
   https://h` then `connect blog https://h/` → same `name` (after
   `CAP-020`; before it, mark expected-failure with `@expectedFailure` and
   a comment) and `imported` unchanged.
7. `test_choices_for_an_app_without_choices_is_an_empty_list`: `choices
   substack --json` → `[]`; `choices obsidian --json` with `OBSIDIAN_HOME`
   → the vault list (`CAP-022` test 7 covers the shape; assert count
   only here).
8. `test_sources_alone_prints_usage_and_exits_2` if not already at
   `test_cli.py:540` (extend rather than duplicate).

## Acceptance criteria

- [ ] `tests/test_e2e_sources_connect.py` exists and connects all eight
      offline apps plus stubbed Granola through `cli.main` in a temp
      `LORE_HOME`.
- [ ] The JSON row keys and the exit-2 stderr contract are asserted
      exactly (string equality, not regex) for at least one success and
      four refusals.
- [ ] Runs on Linux CI (`python-unit`) with no macOS-only dependency and
      no network.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-01 (`catalog --json` shape, unknown app refused, Python CLI
output), W-02 (`connect obsidian` e2e, `choices` CLI), W-03 (CLI
connect for exports), W-05 (`connect substack` JSON), W-13 (CLI usage/
exit codes), W-15 (`--replace` through the CLI), C-01 (state vocabulary
in JSON), C-05, C-23; R-06 (test 6).

Flakiness/safety: in-process; every network is a `serving()` patch;
`FakeKeyring` installed for the Granola case. Keep this file separate
from `XC-051` (which asserts what lands in the store) so a shape change
and a content change fail in different places.
