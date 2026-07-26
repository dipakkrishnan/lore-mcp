---
id: STO-001
title: Stage passively-captured context separately from disclosable memories
priority: P1
effort: M
component: store-import
status: in-review
related: [CLI-001, ONB-001, XC-001]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-26
updated: 2026-07-26
---

## Problem

Every imported memory lands as `pending` and must be individually classified
before it is useful, which is the friction issue #6 describes. The obvious
inversion — keep everything by default — is unsafe if "keep" means `external`,
because `answer` returns any row with `status='external'`. If a passive-capture
tier were modelled as another `status` value, its safety would depend on every
present and future query filtering status correctly; a single wrong `WHERE`
clause would disclose staged material.

## Proposed approach

Add a separate `captures` table (not a fifth `status`) for passively-captured
context, structurally unreachable from `answer` — disclosing a capture should
require a deliberately-written join, not just a status value. Promotion into the
`memories` table is a separate, owner-initiated step (see CLI-001 / the retrieval
flow). Passive capture defaults to non-disclosable; nothing becomes `external`
without an explicit owner action.

Note: flipping the *existing* import default from `pending` to `private` is a
smaller, related change but it alters the review/status model the CLI is built
around (the pending queue empties, `status` "awaiting review" goes to 0), so it
should be weighed in prioritization rather than bundled in silently.

## Acceptance criteria

- [ ] A `captures` table exists that no `mcp.py` code path can return from `answer`.
- [ ] A test asserts that content in `captures` is never returned by `answer`,
      including when its text would match the query.
- [ ] Promotion from `captures` into `memories` is an explicit, tested operation.
- [ ] The decision on the `pending`→`private` default flip is recorded (adopted
      or rejected) rather than left implicit.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6 (Proposals 1
and 5, plus the design note in PR #9). The "separate table, not a status" point
is a security property: make the unsafe disclosure impossible to express rather
than merely absent.
