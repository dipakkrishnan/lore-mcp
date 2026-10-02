---
id: XC-055
title: Live seed suite for the hosted apps (Notion unattended re-read, Granola once seeded)
priority: P3
effort: M
component: cross-cutting
status: in-review
related: [XC-048, XC-049, XC-054, CAP-015, CAP-016, CAP-024, CAP-009, XC-057]
blockers: [XC-049, CAP-015]
dependencies: ["A Granola account with the four seed meetings recorded (manifest gr-01..04; not done yet)", "One attended sign-in per app on the machine that runs the suite, whose tokens live only in that machine's Keychain"]
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The hosted connectors carry the highest drift risk and the least
coverage: Notion's 45-tool list and plan-gated search parameters
(`tests/fixtures/live/notion/tool-access.json`), Granola's tool schemas
(which already changed once, F-gr-01), refresh-token rotation after the
first hour, and the desktop's `SIGN_IN` host allow-list (R-04: Notion's
and Readwise's authorization hosts were never recorded; if they differ
from `mcp.notion.com`/`readwise.io` the desktop silently never opens the
page and the owner waits 300 s). None of these can be tested without a
real server, and none is tested.

## Proposed approach

An opt-in, mostly **unattended** file: sign-in is attended once per
machine (`lore sources connect notion` in the temp home, approve in a
browser), after which every run uses the saved Keychain tokens and must
not open a browser.

### Files

- add `tests/test_live_hosted.py`
- change `docs/testing-connectors.md`: the one-time attended step and
  the rule that the suite's `LORE_HOME` is a **fixed** temp path per
  machine (`$TMPDIR/lore-live-hosted`) because the Keychain entry is keyed
  by server, not home, and a fresh `mkdtemp` would still find the tokens;
  the guard's rule 3 (`XC-049`) is relaxed for this file to "under the
  temp dir" only

### Test design

1. `test_live_notion_reads_unattended_with_saved_tokens`: skip with a
   clear message if `Keychain("https://mcp.notion.com/mcp").get_tokens()`
   is `None` ("run the attended sign-in first"). Then
   `Registry.connect("notion", "", show=fail)` where `fail` raises
   `AssertionError("a browser was asked for")`, so any token expiry that
   falls back to a new sign-in fails loudly. Assert `imported >=
   manifest.sources.notion.expected.kept` (the workspace also holds
   Notion's template pages, F-nt-01, so `>=` not `==`), and that every
   nt-01..05 canary returns one hit; nt-06 returns `[]` after `CAP-017`
   (before it, the title-only memory exists: assert whichever the
   installed code does and say so in the message).
2. `test_live_notion_tool_list_matches_the_recording`: `list_tools()` tool
   names and each tool's `inputSchema` for `notion-search` and
   `notion-fetch` equal the committed `tools-list.json`; a difference
   fails with the JSON diff (drift alarm for R-03).
3. `test_live_notion_second_read_fetches_nothing_new`: `Registry.read`
   twice; the second reports `added 0`.
4. `test_live_notion_refresh_after_an_hour` (manual-only, `@skipUnless
   LORE_LIVE_SLOW=1`): sleep is not acceptable; instead compare the
   Keychain `tokens` entry before and after a read that happens more than
   `expires_in` seconds after the recorded issue time (read
   `OAuthToken.expires_in`; if not yet expired, skip with the remaining
   time in the message). Asserts refresh rotation works without a browser.
5. `test_live_granola_lists_and_reads_the_seed_meetings`: same shape as 1
   for Granola; `imported == expected.kept` (4, or 3 if the free plan
   returns no `private_notes` for gr-04 — assert 3 or 4 and print which,
   turning the manifest's UNCERTAIN into an observation). Skipped until
   the meetings exist (dependency).
6. `test_live_the_approval_host_is_in_the_desktop_allowlist` (R-04):
   attended-only, `LORE_LIVE_ATTENDED=1`: run `sign_in` with a `show`
   that records the URL and immediately raises to abort the flow; assert
   `urlsplit(url).hostname` is in the set parsed from
   `app/desktop/src/state.cjs` line `const SIGN_IN = new Set([...])`. Do
   it for notion and granola; readwise stays unrecorded (paid plan).

### Non-scope

Readwise (paid plan; `CAP-028`), running in GitHub Actions (a Keychain
on a hosted macOS runner would need an attended sign-in per runner
image; decide after the first month of local runs), anything that
writes to Notion or Granola.

## Acceptance criteria

- [ ] `tests/test_live_hosted.py` is skipped by default; with
      `LORE_LIVE_SEED=1` and saved tokens it reads Notion without opening
      a browser and asserts counts, canaries, tool-list equality and
      only-new sync.
- [ ] The Granola test exists and is skipped with the dependency named
      until the seed meetings exist; once they do, it asserts 3 or 4
      kept and states which.
- [ ] The allowlist test records (in the test output, not a file) the
      observed authorization host for Notion and Granola and asserts it
      is in `SIGN_IN`.
- [ ] `docs/testing-connectors.md` documents the one-time attended
      sign-in and the fixed temp home.
- [ ] `uv run python -m unittest discover -s tests` (default, skipped),
      ruff check, ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-09 (live row), W-10 (template pages, unattended re-read,
refresh rotation, `SIGN_IN` host), W-17 (expiry/refresh live), W-25
(hosted half); R-03, R-04, R-13 (free-plan `private_notes`).

Flakiness/safety: tokens never leave the Keychain; the suite reads only.
Notion allows 30 searches a minute; a single run makes at most 2 list
calls and ~25 fetches, well inside. If Notion answers `is_error` for its
managed databases (F-nt-03), that is expected and counted in `errors`,
not a failure.

Sequencing: blocked by `XC-049` (guard) and `CAP-015` (the Granola
listing fix must be committed, or the Granola test can only fail).
