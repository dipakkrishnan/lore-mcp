---
id: XC-009
title: Type-check lore/ with mypy so its annotations mean something
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-003, XC-004, XC-007]
blockers: [XC-004]
dependencies: []
github_issue: null
created: 2026-08-01
updated: 2026-08-03
---

## Problem

`lore/` is already annotated — 95 of its 96 functions carry full parameter and
return types, and most modules opt into `from __future__ import annotations`.
Nothing checks any of it. The annotations read like a contract and are enforced
by nobody, so they drift into being decorative, and a reader who trusts a
signature is trusting something no tool has verified.

They have already drifted. `lore/blueprint.py:233` declares `def apply(file:
Path) -> dict`, and its only caller, `lore/cli.py:573`, passes a `str`. That
works at runtime purely because `apply` happens to call `Path(file)` on the way
in — so the signature is not describing what the function accepts, and a future
caller who reads it and passes a `Path`-only value is relying on a coincidence.

`uv run --with mypy mypy lore/` on `main` reports 7 errors across 5 files, all
of them real (`pydantic` and `windup` both ship `py.typed`, so they resolve
cleanly when mypy runs inside the project environment):

| Location | Finding |
|---|---|
| `lore/cli.py:573` | `str` passed where `apply` declares `Path` |
| `lore/store.py:411` | `int(cursor.lastrowid)` — `lastrowid` is `int \| None` |
| `lore/deploy.py:49` | `copytree` given a `Traversable`, not a path |
| `lore/automation.py:218` | `int()` called on `object` |
| `lore/cli.py:249`, `:314` | `set()` called on `object` |
| `lore/blueprint.py:185` | `dict()` given `Collection[str]`, not pairs |

None is a live crash today. That is the argument for doing this now rather than
after one becomes one — and the count is drifting upward, not down: `deploy.py`
arrived with the node-deploy work and brought a new one with it.

## Proposed approach

1. Add `mypy` to the `dev` optional-dependency group in `pyproject.toml` — the
   same group `XC-003` introduces for `pytest`/`coverage` and `XC-007` uses for
   `ruff`.
2. Configure `[tool.mypy]` in `pyproject.toml` against `lore/` only. Start
   strict enough to be worth having (`warn_unused_ignores`,
   `disallow_untyped_defs`, `warn_return_any`) — the codebase is at 98%
   annotated, so strictness is nearly free here in a way it would not be in an
   untyped tree.
3. Fix the seven findings rather than baselining them. The `object` ones
   (`automation.py:218`, `cli.py:249`, `cli.py:314`) are the interesting group:
   they mean a value crossed a boundary as untyped JSON and its real shape is
   only known by convention. Narrowing them is a small readability win beyond
   satisfying the checker.
4. Add the job to the workflow `XC-004` creates.

`tests/` is deliberately out of scope for the first pass — checking test code
tends to produce a large, low-value diff. Revisit once `XC-003` has reshaped it.

## Acceptance criteria

- [ ] `mypy` runs clean over `lore/` with the configuration committed in
      `pyproject.toml` rather than passed on the command line
- [ ] All seven findings above are fixed at the source, not silenced — any
      remaining `# type: ignore` names its rule and says why in a comment
- [ ] A pull request that introduces a type error fails CI
- [ ] The command is named in the README's development section alongside the
      other checks
- [ ] `apply()`'s signature and its caller agree, whichever direction that is
      resolved in

## Notes

Filed 2026-08-01 from a prioritization-pass finding, and it corrects a claim
made the same day in `XC-007`'s notes: that item described `lore/` as "an
untyped 1,951-line codebase" and scoped type checking out as a large separate
job. That was wrong — the annotations are already there. This is `S`, not the
`L`-shaped effort that phrasing implied. `XC-007`'s note has been amended.

Blocked on `XC-004` for the gating half only, like `XC-007` — the config and the
command can land and be run locally before the workflow exists.

The `store.py:411` finding is the one worth a second look during
implementation. `cursor.lastrowid` is typed `int | None`, and the code assumes
an INSERT always populates it. That is true for sqlite3 in practice, so the fix
is likely an assertion that documents the assumption rather than a behaviour
change — but it is the only finding here that could become a `TypeError` in
production rather than a lie in a signature.
