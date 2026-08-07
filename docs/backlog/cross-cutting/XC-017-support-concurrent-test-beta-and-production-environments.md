---
id: XC-017
title: Support concurrent test, beta, and production environments
priority: P2
effort: L
component: cross-cutting
status: in-review
related: [MON-008, XC-008, XC-002, STO-001]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/87
created: 2026-08-07
updated: 2026-08-07
---

## Problem

An owner has exactly one place to run their lore: whatever they've deployed.
Trying anything new — a plumbing change, a publication edit, a pricing tweak —
means doing it against the same node that answers real buyers, or tearing that
node down first. There is no way to hold a no-stakes space for testing
transactions, and no way to stage a publication change and see it work before
it's live.

`MON-008` solves an adjacent but narrower problem: a *maintainer's* standing QA
deployment of the Worker, for testing this repo's own paid path. That item is
about the project's own CI target. This item is about an *owner's* environments
for their own lore — three of them, coexisting, each addressing a distinct
need:

- **test** — a no-stakes space, open to the public, for exercising the rails
  (capture → publish → discover → answer → settle) without risking real data
  or incurring real inference cost.
- **beta** — a staging space for validating a publication edit meets the
  owner's bar before it reaches production, without the edit being live in
  the meantime.
- **production** — what buyers actually see today.

Nothing in the CLI, the Worker config, or the store currently models "which
environment is this operation for," so there is no way to keep any of the
three running while working in another.

## Proposed approach

Rough shape, not a full design:

1. **Environment identifier.** A first-class `test` | `beta` | `production`
   dimension threaded through deploy config (`lore/deploy.py`,
   `lore/node/wrangler.jsonc`) and the CLI (`lore/cli.py`), the same shape
   `MON-008` introduces for the QA `wrangler.jsonc` environment block, but
   owner-facing and three-valued instead of maintainer-facing and QA-only.
   Each environment gets its own Worker name, its own D1/store, and its own
   settlement wallet — never shared, so a test-environment mistake can't touch
   production data or a production wallet.
2. **Fake/hardcoded content for `test`.** A way to seed the test environment
   with placeholder publications that are obviously not the owner's real
   library — reusing `MON-008`'s fixture-seeding approach — so the rails can be
   exercised publicly without exposing valuable data (issue's privacy ask) or
   spending on real inference (issue's cost ask).
3. **Promotion flow for `beta` → `production`.** A command or documented
   procedure for taking a publication validated in `beta` and making it live in
   `production`, building on the intent-driven publishing flow in `XC-002`
   rather than inventing a second publish path.
4. **Docs.** Each environment's purpose and disposability documented the way
   `MON-008` asks for QA.

Open question, not resolved here: whether `test` and `beta` are always-on
standing deployments (like `MON-008`'s QA) or spun up on demand. Standing is
simpler to reason about; on-demand is cheaper. Needs a decision before
`implementation` starts.

## Acceptance criteria

- [ ] An owner can have a `test`, `beta`, and `production` environment
      deployed simultaneously, each with its own Worker, store, and wallet, and
      switching which one a CLI command targets does not require winding down
      another
- [ ] `test` can be seeded with fake/hardcoded publications and exercise a full
      capture → publish → discover → answer → settle cycle without touching the
      owner's real library or incurring real inference cost
- [ ] A publication can be validated in `beta` and then promoted to
      `production` through a documented flow, without ever being live in
      `production` before that promotion
- [ ] Each environment's config (Worker name, store/D1 binding, wallet) is
      fully distinct from the other two — no shared identifiers that could let
      a test-environment action affect production

## Notes

Cataloged from issue #87, which bundled five related user stories (three
environments coexisting, a no-stakes public test space, fake-content seeding
for privacy, fake-content seeding for cost, and a beta space for validating
publication changes) — kept as one item since all five are facets of the same
environment-tiering architecture rather than independently completable pieces.

Overlaps `MON-008` at the edges: that item is the maintainers' own QA target
for this repo's CI; this item is the owner-facing `test`/`beta`/`production`
split for a deployed lore. If `MON-008` lands first, its `wrangler.jsonc`
environment-block pattern and fixture-seeding approach should be reused here
rather than re-invented.
