---
id: XC-007
title: Gate pull requests on a lint and format check
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-003, XC-004]
blockers: [XC-004]
dependencies: []
github_issue: null
created: 2026-08-01
updated: 2026-08-01
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
3. **CI** — a lint job in `.github/workflows/ci.yml` running both. It needs no
   credentials, so it belongs in the same credential-free tier as `XC-004`'s
   existing jobs.

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

Blocked on `XC-004` only for the gating half — the configs and the two commands
can be written and used locally before the workflow exists.

Deliberately not in scope: type checking `lore/` with `mypy`. That is its own
item — `XC-009`.

Correction (2026-08-01): this note originally justified that split by calling
`lore/` "an untyped 1,951-line codebase". That was wrong. 95 of its 96 functions
are fully annotated; the annotations are simply unchecked. `XC-009` is therefore
`S`, not the large job implied here, and the split stands only because linting
and type checking are separate tools with separate configuration — not because
type checking is expensive.

Prioritization pass 2026-08-01 lowered this from `P1` to `P2`, correcting the
priority it was filed at the same day. The tree is small (115 lines of Worker
TypeScript, nine Python modules) and no lint-class defect has actually been
observed in it, so the payoff is "stop accumulating" rather than "fix something
broken" — which does not outrank proving the payment rail (`MON-002`, `MON-007`).
It stays cheap and worth doing; it just rides along after `XC-004` rather than
ahead of behavioural work. `no-floating-promises` on the settlement path is the
one rule here that is defect-prevention rather than hygiene.
