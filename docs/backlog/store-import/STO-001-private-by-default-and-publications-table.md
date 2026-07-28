---
id: STO-001
title: Private-by-default memories and a separate publications table
priority: P1
effort: M
component: store-import
status: in-review
related: [CLI-001, ONB-001, XC-001, XC-002]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-26
updated: 2026-07-27
---

## Problem

Every imported memory lands as `pending` and must be individually classified,
so review effort grows with memory volume even though external disclosure should
be rare (issue #6). Worse, disclosure is currently modelled as a memory `status`
(`external`), and `answer` returns any row with `status='external'` — so the
externally-reachable set is one `WHERE` clause away from any memory row, and an
external memory exposes a whole imported document rather than a bounded, derived
answer.

## Proposed approach

Adopt the store side of the "Private by Default, Publish by Intent" model:

- New imports default to `private`; migrate existing `pending` rows to `private`.
  `discarded` stays a retention decision. Existing `external` rows remain readable
  during migration but are meant to be converted into publications, not exposed
  indefinitely.
- Add a separate `publications` table — title, bounded derived content, provenance
  references to the private memories it derives from, approval/update timestamps,
  and an `active`/`revoked` state. It is not a memory `status`.
- Move the MCP read path off memories entirely: `discover`/`answer` read
  `publications WHERE active=1` instead of `memories WHERE status='external'`.
  The invariant is **MCP can query publications, never private memories** (nor
  the future captures table). Disclosing a memory must require a deliberately
  written, owner-approved publication — not a status flip.

The raw `captures` staging table (passive session/document capture) is a *separate,
later* table and is out of scope here — see ONB-001, which the doc defers.

## Acceptance criteria

- [ ] New imports persist as `private`; a migration moves existing `pending` to
      `private` without touching `discarded`.
- [ ] A `publications` table exists with content, provenance refs, timestamps, and
      active/revoked state, independent of the `memories` table and its `status`.
- [ ] `discover`/`answer` read only `publications WHERE active=1`; a test asserts
      no `memories` row (any status, including `external`) is reachable from MCP.
- [ ] Revoking a publication removes it from MCP retrieval immediately.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6 and realigned to
Dipak's "Private by Default, Publish by Intent" doc. That doc resolves the earlier
open question here (the `pending`→`private` flip): adopt it. This item is the data
model; the owner-facing publish/approve/revoke flow that fills the table is XC-002,
which this blocks. Supersedes the earlier "stage passive captures" framing — captures
are now a distinct, deferred concern, not conflated with disclosure.
