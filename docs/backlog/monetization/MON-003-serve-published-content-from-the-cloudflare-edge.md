---
id: MON-003
title: Serve published content from the Cloudflare edge instead of canary strings
priority: P2
effort: L
component: monetization
status: in-review
related: [MON-002, MON-004, XC-002, MCP-002]
blockers: [STO-001, XC-002]
dependencies: ["Cloudflare account (Workers + D1)", "Decision: is the edge adapter pursued past the MPP origin gate"]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/25
created: 2026-07-30
updated: 2026-07-30
---

## Problem

`lore/node/src/index.ts` returns a hardcoded sentence to every payer and answers
`discover` with an unconditional `can_help: true`. It proves the payment rail
works and nothing else. For the Cloudflare edge to be a real deployment adapter
it has to serve the owner's actual published content.

The obstacle is that the content lives in `~/.lore/lore.db` on the owner's
machine. If the Worker reaches back to that machine, the endpoint is only alive
while the machine is — a laptop asleep in a bag is a dead paid endpoint, and a
marketplace crawler cannot distinguish that from a node that does not exist.

The edge also hardcodes its price (`lore/node/src/price.ts`) and ignores
`lore price`, so the advertised price and the charged price are two independent
numbers today.

## Proposed approach

Push, don't pull. The owner's machine mirrors **active publications** to
Cloudflare D1 on an explicit publish step; the Worker serves `discover` and
`answer` from D1. The machine makes outbound calls only — no tunnel, no inbound
path, no dependency on it being awake at request time.

Publications are the right unit to mirror, not memories: per `STO-001` they are
bounded, owner-approved claims with explicit `active`/`revoked` state, so the
edge copy contains only what the owner deliberately approved for disclosure.
No private row of any status is ever a candidate.

D1 is SQLite and supports FTS5 virtual tables, so the publications schema and
its FTS query port over nearly verbatim rather than needing a different search
implementation at the edge.

Price comes from the same push: `price_usd` travels with the publication set so
`discover`'s advertised price and `paidTool`'s charged price have one source.

## Acceptance criteria

- [ ] A publish step pushes active publications from `lore.db` to D1; the local
      machine never accepts an inbound connection
- [ ] `answer` returns owner-published content from D1, with provenance, and the
      canary's hardcoded string is gone
- [ ] `discover` reflects real publication matches rather than always claiming
      `can_help: true`
- [ ] No private or revoked row is present in D1 — asserted by a test, not by
      inspection
- [ ] The charged price and the advertised price both derive from `lore price`;
      `lore/node/src/price.ts`'s constant is gone
- [ ] The endpoint answers correctly with the owner's machine powered off

## Notes

Blocked on `STO-001` (the `publications` table, PR #19) because there is nothing
to publish until it lands, and on `XC-002` because an owner-facing publish flow
is what creates publications in the first place. Do not start against the
retired `memories.status='external'` — that status is deleted in PR #19.

Sequencing against MPP: epic #25 puts the paid gate in Lore's own origin via MPP
and calls Cloudflare/x402 "an optional deployment adapter, not a launch
dependency". This item is that adapter. It should not block, duplicate, or
diverge from the origin gate's invariants (#21).

Open decision, deliberately not settled here: mirroring puts approved content in
plaintext in the owner's Cloudflare account. That is a real disclosure step
beyond today even though the rows are the sellable ones, and it should be an
explicit confirmed action with a count, not a silent side effect of `lore sync`.

Related but *not* filed as work: epic #23 already decided to use the payment
provider as the settlement ledger and defer `lore earnings`. Edge settlement
means the Worker is the only party that sees a paid-but-failed answer, which
puts pressure on that decision — revisit it there rather than here.
