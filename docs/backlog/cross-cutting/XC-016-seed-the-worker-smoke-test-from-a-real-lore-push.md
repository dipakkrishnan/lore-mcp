---
id: XC-016
title: Seed the Worker smoke test from a real `lore push --local`, not a hand-copied schema
priority: P1
effort: S
component: cross-cutting
status: ready
related: [CLI-002, XC-013, XC-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-04
updated: 2026-08-26
---

## Problem

The `worker-smoke` job in `.github/workflows/tests.yml` seeds the local D1
`publications` table with a hand-written `DROP TABLE`/`CREATE TABLE`
heredoc, with a comment admitting exactly what this is: "Mirrors the schema
`lore push` maintains (`lore/cli.py:_push_sql`)." That is a second,
independently maintained copy of the schema `_push_sql` generates — two
places that must be kept in sync by a person remembering to, with nothing
that checks they agree.

If `_push_sql`'s column list, types, or defaults ever drift from this copy —
exactly the class of bug `XC-009`'s mypy pass exists to catch elsewhere in
this codebase — the smoke test keeps passing against its own hand-copied
fixture while what `lore push` actually writes silently stops matching what
the Worker reads. The published-content happy path this whole pipeline
exists to serve — an owner runs `lore push`, a buyer's `discover`/`get`
sees it — is exactly the path this job cannot catch breaking, because it
never runs `lore push`.

## Proposed approach

Replace the hand-written seed SQL with the output of a real
`lore push --local` run, against the same `lore/node` directory the job
already installs `npx`/`wrangler` for:

1. Seed a `Store` with one or two sample publications, reusing the fixture
   pattern `tests/test_cli.py`/`tests/helpers.py` already use.
2. Run `lore push --local --worker-dir lore/node` for real.
3. Start `wrangler dev` (as the job already does) and run `scripts/smoke.ts`'s
   unpaid `discover`/402-`get` assertions against the pushed content,
   checking the specific title/teaser/topic values the seed used — not just
   that rows exist.

This turns `worker-smoke` into an actual round-trip of the real happy path
instead of two independently maintained fixtures that happen to agree
today.

## Acceptance criteria

- [ ] `worker-smoke` seeds its local D1 database by running
      `lore push --local`, not a hand-written `CREATE TABLE`/`INSERT` script
- [ ] The smoke assertions check specific content from the seeded
      publications (title, teaser, topic), not just row presence
- [ ] A deliberate change to `_push_sql`'s column list (verify during
      implementation) makes this job fail rather than silently pass against
      a stale hand-copied schema
- [ ] The existing unpaid `discover` and 402-`get` assertions in
      `scripts/smoke.ts` still pass

## Notes

Filed 2026-08-04, found while ideating `CLI-002`/`ONB-002`'s live
happy-path coverage and re-reading `_push_sql`/`push` in `lore/cli.py`.

Related to but distinct from `CLI-002`: that item exercises `push --local`
as one step in the owner's CLI lifecycle and only checks it exits 0; this
item exercises the far side — that what `push` writes is exactly what the
Worker reads — so the two are complementary, not overlapping.

The `# Mirrors the schema...` comment in `tests.yml`'s `worker-smoke` job is
the direct evidence this gap exists; it should be removed once this item
replaces what it was compensating for.

**2026-08-06:** filed as `XC-015` originally; renumbered to `XC-016` before
merging because a different, unrelated `XC-015` ("pin the skill
drive-contract in the contract tests") merged to `main` first via #80 and
claimed that id.

**Prioritization pass 2026-08-26:** No blockers, closes a real fixture-drift gap with a concrete three-step approach. Promoted `in-review` → `ready`.
