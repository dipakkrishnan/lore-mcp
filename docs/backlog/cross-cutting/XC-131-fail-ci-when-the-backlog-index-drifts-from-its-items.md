---
id: XC-131
title: Fail CI when the backlog index drifts from its items or holds conflict markers
priority: P1
effort: S
component: cross-cutting
status: ready
related: [XC-010, XC-078]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-12
updated: 2026-11-12
---

## Problem

`docs/backlog/INDEX.md` is meant to be derived from the item files, but no
check enforces it. On 2026-11-12, `INDEX.md` conflicts were resolved by running
`regenerate_index.py` without `--write`, which only validates. The conflicted
file was committed as it was, and it reached `main` six times (#705, #706,
#708, #709, #710, #703) with every check green. By then `main` had merge-conflict
markers and 517 rows for 513 items until #714 rebuilt it. Nothing told anyone
the index was wrong, and anyone reading it (people, or agents choosing work
from it) saw duplicate and stale rows.

## Proposed approach

Add a `--check` mode to `docs/backlog/agents/regenerate_index.py`. It renders
the table exactly as `--write` would and exits non-zero, naming the first rows
that differ, if the file on disk does not match. It also fails if any line in
`INDEX.md` starts with a conflict marker (`<<<<<<<`, `=======`, `>>>>>>>`).
Run it as a step in an existing ubuntu job in `.github/workflows/tests.yml`.
The Python lint job already covers `docs/backlog/agents`, and it should be a
step there, not a new workflow with a `paths` filter, for the reason XC-078
gives about required checks. Whether to also run it in `pr-title.yml`'s job, or
as a pre-commit hint, is an open choice.

## Acceptance criteria

- [ ] `regenerate_index.py --check` exits 0 on a clean tree and non-zero when
      one item's status is changed without regenerating, naming that item.
- [ ] `--check` exits non-zero when `INDEX.md` contains a conflict-marker line,
      even if every item row is otherwise present.
- [ ] `--check` never writes to `INDEX.md`.
- [ ] CI runs `--check` on every pull request and on pushes to `main`, as a
      step in an existing job (no new required check, no `paths` filter).
- [ ] Unit tests cover the three cases above, with temporary backlog folders,
      under the existing coverage gate.
- [ ] `docs/backlog/agents/audit.md` mentions `--check` as the way to confirm the
      index is current.

## Notes

Found during the 2026-11-12 delivery loop; repaired in #714. The
ordering tie-break reads the existing `INDEX.md`, so `--check` should compare
the set and content of rows separately from their order if order turns out to
be unstable. Check this before choosing an exact-match comparison.

**Prioritization (2026-11-12):** Priority P1 (was P2). Promoted to ready:
unblocked, criteria checkable, and the premise checked against the code.
