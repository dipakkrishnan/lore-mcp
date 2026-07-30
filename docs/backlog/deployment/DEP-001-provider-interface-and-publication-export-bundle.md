---
id: DEP-001
title: Build the lore-deploy provider interface and publication export bundle
priority: P1
effort: M
component: deployment
status: in-review
related: [DEP-002, DEP-003, ONB-002, XC-002]
blockers: [STO-001]
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

A Lore node is reachable only where it runs — `lore serve` over stdio for a local
agent, or `lore serve --transport http` bound to loopback. For another person's
agent to call `discover`/`answer`, the owner has to solve reachability entirely on
their own, and nothing in the repo tells them how.

Two providers are being tried in parallel (`DEP-002`, `DEP-003`). Without a shared
interface and a shared export format they will diverge into two bespoke scripts,
and the comparison they exist to produce becomes impossible to make.

The export format is the load-bearing half. Deployment means copying disclosable
content to infrastructure Lore does not control, so exactly what is in that copy
is a security boundary, not a serialization detail.

## Proposed approach

Per `docs/deployment-mvp.md`, two pieces:

**The bundle.** Export `publications WHERE active=1` plus `price_usd`, and nothing
else. Per publication: `id`, `title`, `content`, `kind`, `created_at`,
`updated_at`. Omit `provenance` — `STO-001` requires that no buyer-facing payload
disclose provenance memory ids, and the strongest way to honor that on a remote
copy is for the ids to never be in it. Omit `source_changed_at` as an owner-facing
signal. The bundle is a single SQLite database file holding exactly that subset
plus its FTS index, so any runtime with SQLite reuses Lore's own BM25 search
unchanged. It is content-addressed by a digest over a canonical serialization of
its rows — not the raw file bytes, which SQLite does not keep stable across
rebuilds — and the digest is recorded locally, so drift is detectable without a
network call.

**The interface.** One provider lifecycle — `preflight`, `authenticate`,
`provision`, `push_bundle`, `expose`, `verify`, `record` — so adding a provider
needs no change to the skill's flow, and so AWS and Cloudflare are comparable.
Plus the local metadata the skill needs to be idempotent: deployment record,
staleness flag, and a way to read both back.

**Staleness, which this item owns.** `STO-001` guarantees revocation is immediate.
A deployed bundle is a copy, and that guarantee does not survive copying — a
revoked publication stays answerable from the cloud until the bundle is re-pushed.
Mitigation: revoking or flagging a publication (or changing `price_usd`) marks the
deployment stale, `lore status` shows the drift, a re-push clears it, and the
deployed function refuses to serve a bundle older than the owner's configured max
age, failing closed. The age bound exists only to cap revocation latency — an old
bundle nothing was revoked from is harmless, but the function cannot know that —
so it is chosen at deploy time (default 7 days) and may be disabled, with the
skill stating the trade-off and requiring confirmation. The fail-closed refusal is
the load-bearing part for any owner who keeps a bound; the rest is convenience.

## Acceptance criteria

- [ ] The export contains only `publications WHERE active=1` plus `price_usd`, and
      a test asserts no memory row of any status appears in a bundle
- [ ] The export omits `provenance` and `source_changed_at` from every publication
- [ ] The bundle is a SQLite file of exactly the exported subset; its digest is
      computed over a canonical serialization of its rows, recorded locally, and
      drift is detectable without a network call
- [ ] Revoking or flagging a publication, or changing `price_usd`, marks the
      recorded deployment stale, and `lore status` reports the drift and its age
- [ ] The bundle max age is owner-configurable at deploy time, defaulting to 7
      days; disabling it states the revocation trade-off and requires explicit
      confirmation
- [ ] The lifecycle includes an approval step — every mutating provider command is
      shown to the owner before it runs — and the test double proves the flow
      cannot skip it
- [ ] Providers implement one documented lifecycle interface; a test double
      provider exercises the full skill flow without touching a real cloud account
- [ ] Re-running deployment against a recorded deployment updates in place rather
      than provisioning a duplicate
- [ ] Deployment refuses to proceed when the library has zero active publications,
      and explains that the node would answer nothing
- [ ] Cloud credentials are never written to `lore.db` or any prompt file; only
      non-secret deployment metadata is recorded

## Notes

Transposed from Shane's 2026-07-30 paper sketch; design in
`docs/deployment-mvp.md`.

Blocked by `STO-001` — there is nothing to export until the `publications` table
lands (PR #19). Blocks `DEP-002` and `DEP-003`, which are the two providers being
compared.

The 7-day *default* max age is still a guess even with the bound configurable: it
trades disclosure risk against forced re-push cadence. Also unresolved: whether the
refusal should be a hard MCP error or a degraded response with a warning. Hard
error is proposed as the only version that fails closed. Where the payment gate
runs for a deployed node is deliberately not resolved here — see `XC-004`.

Whether `lore deploy` exists as a command or stays skill-only is open, but the
skill needs *some* local command to record and read deployment metadata —
`sync`, `status`, and `destroy` are the plausible minimum.
