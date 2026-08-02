---
id: STO-001
title: Private-by-default memories and a separate publications table
priority: P0
effort: M
component: store-import
status: completed
related: [CLI-001, ONB-001, XC-001, XC-002]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/6
created: 2026-07-26
updated: 2026-08-02
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

- New imports default to `private`, and `pending` and `external` are retired from
  the status model outright: retention (`private` / `discarded`) is the only thing a
  memory status expresses. **No migration and no back-compat** — roll forward
  (resolved in review, Dipak). Any pre-existing `external` row simply stops being
  disclosable, since nothing outside `publications` is reachable from MCP.
- Add a separate `publications` table — title, content, provenance references to the
  private rows it derives from, approval/update timestamps, an `active`/`revoked`
  state, and a `source_changed_at` flag (below). It is not a memory `status`. A publication's content is either a **derived
  bounded claim** or **explicitly-promoted verbatim content** (see XC-002); the
  schema stores both, but promotion is always an explicit per-item owner choice.
- Move the MCP read path off memories entirely: `discover`/`answer` read
  `publications WHERE active=1` instead of `memories WHERE status='external'`.
  The invariant is **MCP can query publications, never private rows of any kind**
  (memories, private synthesized claims, uploaded content, or the future captures
  table). Disclosing anything must require a deliberately written, owner-approved
  publication — not a status flip.

- A memory changing must not re-open a review queue, so editing one keeps its
  retention status. What a change can invalidate is a *publication* derived from it,
  so those are flagged (`source_changed_at`) for the owner to re-approve or revoke.
  Flagged is deliberately **not** revoked: the published text is unchanged and is
  still exactly what the owner approved, so it stays readable while the owner is told
  about it.

Deferred and out of scope here: the raw `captures` staging table (passive session
capture, see ONB-001) and the **uploaded-content ingest path** — the private tier
reserves a place for owner-uploaded documents, but building that ingest is a later
store-import item, not part of this one.

## Acceptance criteria

- [x] New imports persist as `private`, and `private`/`discarded` are the only
      statuses that exist — `pending` and `external` are rejected by the store, the
      schema, and the CLI. (Superseded the original "a migration moves existing
      `pending` to `private`": review resolved this as roll-forward, no migration.)
- [x] A `publications` table exists with content (a derived claim or promoted
      verbatim content), provenance refs, timestamps, and active/revoked state,
      independent of the `memories` table and its `status`.
- [x] `discover`/`answer` read only `publications WHERE active=1`; a test asserts
      no private row of any kind (memory of any status, private synthesized claim,
      uploaded content) is reachable from MCP.
- [x] Revoking a publication removes it from MCP retrieval immediately.
- [x] Nothing in the buyer-facing payload discloses provenance memory ids.
- [x] Editing a memory keeps its retention status and flags publications derived
      from it, without revoking them.

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

Implemented on `feat/sto-private-publications` (PR
https://github.com/dipakkrishnan/lore-mcp/pull/19), 36 tests passing, all acceptance
criteria verified. PR #19 merged to main (`8e97adc`), so this moved to `completed`
on 2026-08-02 per the README's "completed = merged" definition. Deferred, as designed: uploaded-content
ingest and the raw captures table.

Revised 2026-07-29 after Dipak's review on PR #19. Four changes to the item itself:

1. **The migration acceptance criterion is void.** It required moving `pending` rows
   to `private`; review resolved to drop legacy handling entirely and roll forward,
   so there is no migration to test. Rewritten as "these are the only two statuses."
2. **`pending` and `external` are retired**, not merely unused. The review card no
   longer offers a disclosure key at all, which closes the "is `external` worth
   keeping as a publication-candidate marker" question: it is not.
3. **Publication staleness was added** in response to a genuine conflict: `main` had
   started sending edited memories back to `pending`, which rebuilds the queue this
   item exists to remove. Flagging derived publications instead puts the cost on
   disclosure, where XC-001 says it belongs.
4. **`Memory` and `Publication` are pydantic models** with `Status`/`PublicationKind`
   enums, so status and kind membership is enforced by the types.

Two consequences outside this item: `MON-001` is closed obsolete (Cloudflare is out),
and `answer` returns nothing for a real user until `XC-002` ships the owner-facing
publish flow, since nothing here can create a publication outside Python.
