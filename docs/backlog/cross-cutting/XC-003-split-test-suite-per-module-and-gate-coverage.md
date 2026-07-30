---
id: XC-003
title: Split the test suite into per-module files and gate coverage at 90%
priority: P2
effort: L
component: cross-cutting
status: in-review
related: [STO-001, XC-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-29
updated: 2026-07-29
---

## Problem

The entire suite is one 472-line `tests/test_lore.py` with a single
`LoreTest(unittest.TestCase)` class holding 29 tests across all nine modules in
`lore/`. There is no way to run the tests for one module, a failure doesn't point
at an owning component, and nothing stops a new module from shipping with no
tests at all.

Coverage reflects that. Measured on `main`, `lore/` sits at 60% combined
statement+branch, and the gap is concentrated in the two largest and most
user-facing modules: `lore/cli.py` at 31% (151 of 233 statements never executed)
and `lore/mcp.py` at 41% (81 uncovered). Every command body in `cli.py` —
`import`, `search`, `review`, and their error paths — is untested, as is the
entire MCP HTTP transport. Nothing enforces a floor, so that number can drift
down silently, which matters most right now because `STO-001` and `XC-002` are
actively rewriting the store and publishing paths that `mcp.py` exposes.

## Proposed approach

1. Split `tests/test_lore.py` into one file per source module, mirroring names:
   `tests/test_paths.py`, `test_store.py`, `test_sources.py`, `test_ui.py`,
   `test_blueprint.py`, `test_automation.py`, `test_mcp.py`, `test_cli.py`.
   Move the 29 existing tests to the file that owns the code they exercise —
   several currently span modules (`test_private_data_and_terminal_output_are_protected`
   touches `store`, `ui`, and `paths`), and those get split, not duplicated.
   Lift shared setup (`_blueprint_input`, the tmpdir/`Store` fixture, stdout
   capture) into `tests/conftest.py` or `tests/helpers.py` rather than
   copy-pasting it into eight files.
2. Add `pytest`, `pytest-cov`, and `coverage` as a `dev` optional-dependency
   group in `pyproject.toml`. Tests can stay `unittest.TestCase`-based — pytest
   collects them as-is — so this is a runner change, not a rewrite.
3. Write the missing tests to clear the floor. The bulk of the work is
   `lore/cli.py` (command dispatch, argument parsing, error and exit-code paths)
   and `lore/mcp.py` (transport, auth rejection, malformed tool input);
   `ui.py` (68%) and the 85-94% modules need targeted branch tests, not new
   scaffolding.
4. Configure the gate in `pyproject.toml` under `[tool.coverage.*]`:
   `source = ["lore"]` so tests aren't counted toward the percentage,
   `branch = true`, `fail_under = 90`.

Note on "all metrics": coverage.py's `fail_under` checks one *global* combined
number, so a file at 96% statements / 70% branches hides behind it, and a
well-covered module can carry a bare one. To actually hold 90% on each metric,
the gate needs a small check over `coverage json` output asserting per-file
statement % and branch % separately. Prefer that over the bare `fail_under` —
keep `fail_under` as the cheap outer guard. coverage.py has no native
function-level metric; statements and branches are the two it reports, so those
are the two the 90% applies to.

## Acceptance criteria

- [ ] `tests/test_lore.py` is gone; every module in `lore/` with meaningful
      logic has a same-named `tests/test_<module>.py`, and all 29 original
      assertions still exist somewhere (no coverage lost in the move).
- [ ] Running one module's tests works in isolation: `pytest tests/test_cli.py`
      passes on its own, without depending on another test file's setup.
- [ ] Every file in `lore/` is at >=90% statement coverage **and** >=90% branch
      coverage, verified per-file rather than only in the total.
- [ ] A single documented command exits non-zero when either metric drops below
      90% on any file, and that command is in the README's development section.
- [ ] Coverage measures `lore/` only — `tests/` is not counted toward the
      percentage.

## Notes

Baseline measured 2026-07-29 on `main` (93244bc) via
`coverage run --branch -m unittest discover -s tests`:

| Module | Stmts | Miss | Branch | BrPart | Cover |
|---|---|---|---|---|---|
| `lore/__init__.py` | 1 | 0 | 0 | 0 | 100% |
| `lore/paths.py` | 11 | 0 | 0 | 0 | 100% |
| `lore/automation.py` | 67 | 4 | 10 | 1 | 94% |
| `lore/sources.py` | 50 | 4 | 14 | 1 | 92% |
| `lore/store.py` | 95 | 10 | 22 | 6 | 86% |
| `lore/blueprint.py` | 117 | 13 | 40 | 11 | 85% |
| `lore/ui.py` | 42 | 11 | 8 | 1 | 68% |
| `lore/mcp.py` | 136 | 81 | 48 | 14 | 41% |
| `lore/cli.py` | 233 | 151 | 80 | 6 | 31% |
| **TOTAL** | **752** | **274** | **222** | **40** | **60%** |

Effort is `L` almost entirely because of step 3. The split itself is a few
hours; taking `cli.py` from 31% to 90% is the long pole and may deserve its own
follow-up item if this one runs long.

Sequencing: `STO-001` and `XC-002` are changing `store.py`, `mcp.py`, and the
CLI surface. Splitting the files is safe either way, but writing the new
`mcp.py`/`cli.py` tests before those land means rewriting them. Consider doing
steps 1-2 now and steps 3-4 once `XC-002` settles.

There is no CI in this repo (no `.github/workflows/`), so the gate as specified
here is local-only. Wiring it into GitHub Actions is worth a separate item — an
unenforced threshold decays.
