---
id: XC-048
title: Define the connector test levels, their layout and where each runs
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [XC-003, XC-004, XC-008, CLI-002, CAP-009, XC-049, XC-050, XC-051, CAP-015]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The connector code (`lore/sources.py`, `lore/signin.py`, the `sources` CLI,
the desktop bridge) is tested at two levels only: unit/component tests
against hand-written stubs, and one Electron edge walk. Seeding fictional
accounts left seven recorded real answers under `tests/fixtures/live/`
(blog, substack, medium, bluesky, notion, granola tool schemas, a Claude
export shape) and **no test reads any of them** (verified: the only
reference is an `is_file()` check in `tests/test_seed_hygiene.py:158`).
That is how the Granola `list_meetings` drift (F-gr-01) reached an owner
while the suite stayed green: the stub in `tests/fixtures/granola.py:31-35`
still models the old arguments.

Nothing says what a "contract" or "live" test is here, where such a file
goes, how it is opted into, or which CI job runs it. Every per-connector
test item that follows (CAP-015..029, CLI-010/011, XC-049..057, APP-178/179)
needs those answers once, not fifteen times.

## Proposed approach

One short design, checked in as `docs/testing-connectors.md`, plus the
skeleton that makes it real. It does not write connector tests itself.

### Level definitions (fix these names; every later item uses them)

| level | what it proves | doubles | file naming |
|---|---|---|---|
| unit | one function, no I/O | none | existing `tests/test_<module>.py` |
| contract | our reader vs a **recorded real answer** under `tests/fixtures/live/<connector>/`, or vs a vendor tool schema (`jsonschema`) | the recording | `tests/test_contract_<connector>.py` |
| component | a `Reader`/`Registry` against an in-process stub (`serving()` in `test_feed.py`/`test_hosted.py`) or a fixture folder | stub | existing `tests/test_<module>.py` |
| e2e | `cli.main([...])` or `lore` as a subprocess, throwaway `LORE_HOME`, stand-ins for every network | stub servers | `tests/test_e2e_<area>.py` |
| live | real network to the fictional seed accounts only; opt-in; never a PR gate | none | `tests/test_live_<connector>.py` |
| tags | `sec` / `perf` / `resil` / `hyg` are test-name prefixes inside any level, not directories | | `test_sec_…`, `test_perf_…` |

Keep files flat under `tests/` so `uv run python -m unittest discover -s
tests` and `tests/gate.py` keep working unchanged; the prefix, not a
directory, is the marker.

### Opt-in mechanism for live

- Module-level `@unittest.skipUnless(os.environ.get("LORE_LIVE_SEED") == "1", "live seed suite is opt-in")`
  on every `test_live_*.py` class, so the default run reports them as
  skipped, never as passed.
- The guard helpers (temp `LORE_HOME`, handle allow-list, drift diff) are
  `XC-049`'s job; this item only reserves the env var name and the file
  prefix.

### CI wiring (`.github/workflows/tests.yml`)

- `python-unit` already runs `discover -s tests`, which now includes
  contract and e2e files; nothing to add except a comment naming the
  levels.
- Add a `python-live-seed` job with `on: workflow_dispatch` and `schedule`
  (weekly), `if: github.repository == 'dipakkrishnan/lore-mcp'` (never
  forks, mirroring `XC-008`), env `LORE_LIVE_SEED=1`, `LORE_HOME` set to
  `${{ runner.temp }}/lore-live`, running
  `uv run python -m unittest discover -s tests -p "test_live_*.py" -v`.
  It needs **no secrets**: the feed connectors read public accounts.
  Hosted live reads (Keychain) stay attended/local until `XC-055` decides
  a runner.
- Add `jsonschema>=4` to the `dev` dependency group in `pyproject.toml`
  (already in `uv.lock` transitively through `mcp`; make the import
  explicit).

### Files

- add `docs/testing-connectors.md` (the table above, the naming rule, the
  opt-in rule, the "recordings are read-only; refresh through
  `support/seed/record.py` and `hygiene_check.py`" rule, and a pointer to
  the seed corpus/manifest as the source of expected counts)
- change `.github/workflows/tests.yml` (new job), `pyproject.toml` (dev
  group), `docs/connectors.md` step 3 ("Add the app to the `connectors`
  edge scenario and to the catalog test") to also require a contract test
  when a recording exists
- add `tests/test_live_smoke.py`: one skipped-by-default test that asserts
  `LORE_LIVE_SEED` is set, so the workflow is proven to select the prefix
  (replaced by real live tests later)

### Test design

1. `tests/test_live_smoke.py::test_the_live_suite_is_opt_in` — under the
   default environment the class is skipped; with `LORE_LIVE_SEED=1` it
   runs and passes. Assert by running `unittest` twice in a subprocess
   from `tests/test_package.py` (or a new `tests/test_levels.py`) and
   checking the summary line contains `skipped=1` then `OK`.
2. `tests/test_levels.py::test_every_test_file_declares_a_known_level` —
   every `tests/test_*.py` name matches
   `test_(contract|e2e|live)_.*` or is a per-module file; a live file
   without the `skipUnless` guard fails this test (grep the source for
   `LORE_LIVE_SEED`).

## Acceptance criteria

- [ ] `docs/testing-connectors.md` exists and defines the five levels, the
      file-naming rule, the tags, and the `LORE_LIVE_SEED=1` opt-in.
- [ ] `tests/test_levels.py` enforces the naming/guard rule and passes.
- [ ] `.github/workflows/tests.yml` has a `python-live-seed` job that runs
      only on `workflow_dispatch`/`schedule`, never on `pull_request`,
      never on forks, with no secrets.
- [ ] `jsonschema` is an explicit dev dependency and `uv run python -c
      "import jsonschema"` works.
- [ ] `uv run python -m unittest discover -s tests` passes with the live
      smoke test reported as skipped.
- [ ] `uv run --extra dev ruff check lore tests evals .github/scripts
      docs/backlog/agents support/seed`, `ruff format --check` on the same
      paths, and `uv run --extra dev mypy lore evals .github/scripts
      docs/backlog/agents support/seed` pass.

## Notes

Covers: W-25 (structure only), C-34 (which CI job owns what); the
level vocabulary used by every item in this batch. Epic for XC-049,
XC-050, XC-051, CAP-016, CAP-018, CAP-019, CAP-021, CLI-010, CLI-011,
XC-054, XC-055, APP-179, which list it as a blocker.

Not blocked on this: the bug items (CAP-015, CAP-017, CAP-020, CAP-025,
CAP-027) and the gap-filling unit/component items (CAP-022..024, 026,
028, 029, XC-052, XC-053, XC-056, XC-057, APP-178), which land in existing
files.

Flakiness/safety: nothing here touches a network or `~/.lore`; the live
job is dispatch/schedule only. Precedents: `XC-003` (per-module split and
gate), `XC-008` (live tier design: no forks, protected environment),
`CLI-002` (subprocess CLI chain). `docs/test-plan-handoff.md` asked the
"record/replay vs hand-written fakes" question for the Worker; the answer
for connectors is both, at different levels: fakes at component, recordings
at contract, and `XC-050` makes the recordings replayable as fakes.
