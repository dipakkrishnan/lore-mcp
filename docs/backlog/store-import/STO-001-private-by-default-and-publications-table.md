---
id: STO-001
title: Private-by-default memories and a separate publications table
priority: P0
effort: M
component: store-import
status: ready
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

Adopt the store side of the "Private by Default, Publish by Intent" model. Two
tiers, split by disclosure:

**Private tier** (owner-only) holds several content kinds:
- memory rows (agent-generated, imported today);
- private synthesized claims;
- uploaded content (owner-added documents) — *modeled now, ingest deferred* (see
  below).

**Public tier** is the `publications` table — the only thing MCP can read.

Concretely:

- New imports default to `private`; migrate existing `pending` rows to `private`.
  `discarded` stays a retention decision. Existing `external` rows remain readable
  during migration but are meant to be converted into publications, not exposed
  indefinitely.
- Add a separate `publications` table — title, content, provenance references to the
  private rows it derives from, approval/update timestamps, and an `active`/`revoked`
  state. It is not a memory `status`. A publication's content is either a **derived
  bounded claim** or **explicitly-promoted verbatim content** (see XC-002); the
  schema stores both, but promotion is always an explicit per-item owner choice.
- Move the MCP read path off memories entirely: `discover`/`answer` read
  `publications WHERE active=1` instead of `memories WHERE status='external'`.
  The invariant is **MCP can query publications, never private rows of any kind**
  (memories, private synthesized claims, uploaded content, or the future captures
  table). Disclosing anything must require a deliberately written, owner-approved
  publication — not a status flip.

Deferred and out of scope here: the raw `captures` staging table (passive session
capture, see ONB-001) and the **uploaded-content ingest path** — the private tier
reserves a place for owner-uploaded documents, but building that ingest is a later
store-import item, not part of this one.

## Acceptance criteria

- [ ] New imports persist as `private`; a migration moves existing `pending` to
      `private` without touching `discarded`.
- [ ] A `publications` table exists with content (a derived claim or promoted
      verbatim content), provenance refs, timestamps, and active/revoked state,
      independent of the `memories` table and its `status`.
- [ ] `discover`/`answer` read only `publications WHERE active=1`; a test asserts
      no private row of any kind (memory of any status including `external`, private
      synthesized claim, uploaded content) is reachable from MCP.
- [ ] Revoking a publication removes it from MCP retrieval immediately.

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/6 and realigned to
Dipak's "Private by Default, Publish by Intent" doc. That doc resolves the earlier
open question here (the `pending`→`private` flip): adopt it. The doc's other open
question — publication as bounded claim vs. request-time policy — is now resolved
(Shane + Dipak): **bounded claims**, with the extension that a publication may also
be explicitly-promoted verbatim content (see XC-002). This item is the data model;
the owner-facing publish/approve/revoke flow that fills the table is XC-002, which
this blocks. Supersedes the earlier "stage passive captures" framing — captures are
now a distinct, deferred concern, not conflated with disclosure.
