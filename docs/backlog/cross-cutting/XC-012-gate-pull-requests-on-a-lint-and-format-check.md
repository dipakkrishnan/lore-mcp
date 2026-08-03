---
id: XC-012
title: Gate pull requests on a lint and format check
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-003, XC-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-01
updated: 2026-08-03
---

## Problem

There is no linter in this repository, on either side of it. `pyproject.toml`
declares no `ruff`, `black`, `flake8`, or `mypy` configuration; `lore/node/` has no
`eslint`, `prettier`, or `biome` config, and its `npm run check` is `tsc
--noEmit` and nothing else. There is no `.editorconfig` and no pre-commit hook.

So "lint" is not a stage that can be added to CI — the command it would run
doesn't exist yet. Today the only enforcement of unused imports, dead branches,
shadowed names, unawaited promises, or import ordering is a human noticing them
in review, across 1,951 lines of Python in `lore/` and 115 lines of TypeScript in
`lore/node/`.

The Worker is where this stings most. It does async settlement against a
facilitator, and `tsc --noEmit` will not flag a floating promise or an
unhandled rejection — the two failure modes that lose a payment quietly rather
than loudly.

## Proposed approach

Add one linter per language, each with a single documented command, then hang
both off the workflow `XC-004` creates.

1. **Python** — `ruff` as a `dev` optional-dependency in `pyproject.toml`
   (`XC-003` is already adding that group for `pytest`/`coverage`; share it).
   `ruff check` plus `ruff format --check`, configured under `[tool.ruff]`.
   Start with the default rule set plus `I` (import sorting) and `B`
   (bugbear); resist enabling everything on the first pass.
2. **Worker** — `eslint` with `typescript-eslint`'s type-checked config, whose
   whole point here is `no-floating-promises` and `no-misused-promises`. Add it
   as `npm run lint` in `lore/node/package.json`, alongside the existing `check`.
3. **CI** — a lint job in the existing `.github/workflows/tests.yml`, running
   both. It needs no credentials, so it belongs in the same credential-free tier
   as that workflow's existing job.

Fix the existing violations in the same change rather than starting with a
suppression file — the codebase is small enough that a baseline of ignores would
cost more than it saves.

## Acceptance criteria

- [ ] `ruff check` and `ruff format --check` pass over `lore/` and `tests/`, and
      the rule set is configured in `pyproject.toml` rather than passed on the
      command line
- [ ] `npm run lint` in `lore/node/` passes with `no-floating-promises` enabled and
      type-aware linting turned on
- [ ] A pull request introducing a lint violation on either side fails CI
- [ ] Both commands are named in the README's development section, so local and
      CI checks cannot drift (same requirement `XC-004` sets for its jobs)
- [ ] No violations are silenced by a baseline/ignore file; anything genuinely
      not worth fixing is disabled as a named rule with a reason

## Notes

Sized `S` on the size of the tree: 115 lines of Worker TypeScript and nine
Python modules. If the first `ruff check` run turns up a large fixable diff,
land the formatter as its own commit so the rule-violation fixes stay reviewable.

Not blocked, though only half of it can be finished alone: the configs and the
two commands can be written and used locally today, while the gate itself needs
the workflow `XC-004` extends. `XC-009` and `MON-010` are unblocked on the same
reasoning — the check can exist before anything runs it.

Deliberately not in scope: type checking `lore/` with `mypy`. That is its own
item, `XC-009`, and it is `S` rather than a large job because `lore/` is already
95-of-96 annotated — the annotations are simply unchecked. The split between the
two items is about linting and type checking being separate tools with separate
configuration, not about type checking being expensive.

Filed at `P2` rather than `P1`. The tree is small — 115 lines of node TypeScript,
ten Python modules — and no lint-class defect has actually been observed in it,
so the payoff is "stop accumulating" rather than "fix something broken", which
does not outrank proving the payment rail (`MON-010`). It stays cheap and worth
doing; it just rides along after `XC-004` rather than ahead of behavioural work.
`no-floating-promises` on the settlement path is the one rule here that is
defect-prevention rather than hygiene.

Renumbered from `XC-007` to `XC-012` on 2026-08-03: open PR #47 filed its own
`XC-007` on 2026-07-31, a day before this one, and has the better claim.
