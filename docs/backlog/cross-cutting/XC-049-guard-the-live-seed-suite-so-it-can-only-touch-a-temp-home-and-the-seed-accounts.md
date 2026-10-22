---
id: XC-049
title: Guard the live seed suite so it can only touch a temp home and the seed accounts
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-048, XC-008, XC-054, XC-055, XC-053, XC-056]
blockers: [XC-048]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Nothing today prevents a live run from importing into `~/.lore` or from
reading a handle that is not a seed account (R-11): the seeders guard only
on the `tidewell-seed` marker, `lore` itself reads whatever `LORE_HOME`
says, and `record.py` writes scrubbed files straight into
`tests/fixtures/live/`. The live suite `XC-054`/`XC-055` will run under
`LORE_LIVE_SEED=1` on a schedule and on people's laptops; one mis-set
variable would either pollute the owner's real library or commit an
unscrubbed recording. The guardrails have to exist before the first live
test does.

## Proposed approach

One helper module every `test_live_*.py` imports, and one CLI entry for
refreshing recordings that never writes into the repo directly.

### Files

- add `tests/liveguard.py`
- add `tests/test_liveguard.py` (unit tests of the guard; these run by
  default, they need no network)
- change `support/seed/record.py`: add `--check` (drift mode, see below)
- change `docs/testing-connectors.md` (from `XC-048`): the guard rules

### `tests/liveguard.py`

```python
def enabled() -> bool                     # LORE_LIVE_SEED == "1"
def seed_home() -> Path                   # asserts and returns a safe LORE_HOME
def seed_locator(connector: str) -> str   # locator from manifest accounts/sources only
def drift(connector: str, fresh: Path) -> list[str]   # committed vs fresh sha256
```

Rules `seed_home()` enforces, each raising `RuntimeError` with a one-line
reason:

1. `LORE_HOME` is set (never the default `~/.lore`).
2. Its resolved path is under `tempfile.gettempdir()` or under
   `$RUNNER_TEMP`, and is not a parent of the repo or of `Path.home()`.
3. It does not contain a `lore.db` older than the current process (a
   reused home is a leak of one run into the next); `XC-054` creates a
   fresh `mkdtemp()` per test class.

`seed_locator()` returns only locators found in
`support/seed/manifest.json` `accounts` / `sources[*].locator` and refuses
any other string, so a test cannot be pointed at a real person's handle by
an environment override. The seed handles are referenced by manifest
lookup, never spelled in test code.

`drift()` re-records into a temp directory using `record.py`'s existing
`record_feed`/`record_hosted` with `--raw <tmp> --out <tmp>`, then compares
each `meta.json` request's `sha256_raw` against the committed
`tests/fixtures/live/<connector>/meta.json`. It returns the list of
`url_or_tool` whose hash differs; it never writes under `tests/fixtures/`.
Committing a refreshed recording stays manual: copy from the temp out dir,
run `uv run python support/seed/hygiene_check.py`, review the diff.

### Test design (`tests/test_liveguard.py`, runs by default)

1. `test_the_real_home_is_refused`: `LORE_HOME` unset → `RuntimeError`
   mentioning `LORE_HOME`; `LORE_HOME=~/.lore` (expanded) → refused.
2. `test_a_temp_home_is_accepted`: `LORE_HOME=mkdtemp()` → returned.
3. `test_a_home_inside_the_repo_is_refused`.
4. `test_only_manifest_locators_are_offered`: `seed_locator("blog")`
   equals `manifest["sources"]["blog"]["locator"]`;
   `seed_locator("evernote")` raises; an env var like
   `LORE_LIVE_BLOG=https://example.com` has no effect.
5. `test_drift_reports_changed_answers_and_nothing_else`: write a fake
   committed `meta.json` (two requests) and a fresh one where the second
   hash differs → `drift()` returns exactly `[second url]`; identical →
   `[]`. Use a temp copy of the fixture tree, never the real one.
6. `test_record_check_never_writes_under_the_repo`: run
   `record.py feed blog http://127.0.0.1:<port> --check` against the
   corpus served by `http.server` (same stub as
   `tests/test_seed_tools.py:160`) and assert `tests/fixtures/live/blog`
   mtimes are unchanged and the temp out dir holds the new files.

## Acceptance criteria

- [ ] `tests/liveguard.py` exists with the four helpers and the rules above;
      `tests/test_liveguard.py` covers each refusal and passes without
      `LORE_LIVE_SEED`.
- [ ] `record.py --check` reports drift per request and leaves
      `tests/fixtures/live/` untouched (asserted by test 6).
- [ ] `docs/testing-connectors.md` states: live tests import `liveguard`,
      call `seed_home()` in `setUpClass`, take locators from
      `seed_locator()`, never post, never cite the seed handles in code,
      and refresh recordings only through `record.py --check` followed by
      `hygiene_check.py`.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-25 (guard, drift diff, scrub-before-commit rows), R-11, R-12
(recording refresh path), C-31 (`record.py` gains `--check`).

Flakiness/safety: every test here uses a temp directory and a local
`http.server`; no network. The helper deliberately has no "override"
flag: if a person needs to run against something else, that is not the
live seed suite.

Sequencing: blocked by `XC-048` (the env var name and file prefix).
Blocks `XC-054` and `XC-055`.
