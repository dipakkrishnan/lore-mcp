---
id: MON-005
title: Cut the x402 edge adapter over to mainnet
priority: P3
effort: M
component: monetization
status: ideation
related: [MON-002, MON-003, MON-004]
blockers: [MON-002, MON-003, MON-004]
dependencies: ["CDP account and API credentials", "Decision to launch the edge adapter at all"]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/25
created: 2026-07-30
updated: 2026-07-30
---

## Problem

Everything in `lore/node/` is Base Sepolia: `eip155:84532` with the public
`x402.org` facilitator. That is play money and a facilitator that exists for
testing. Taking real payment needs `eip155:8453` and a mainnet-capable
facilitator with credentials — in practice Coinbase's CDP facilitator and its
JWT authentication.

This is the only step in the edge adapter that cannot be undone: real money
moves, and real content is disclosed to strangers who paid for it.

## Proposed approach

Unclear in detail — needs the evidence from `MON-002` before it can be specified
honestly. What is known: the network constant changes, the facilitator gains an
authenticated client, and CDP credentials have to be configured as Worker
secrets rather than the current credential-free setup.

Prior art exists: closed PR #26 built exactly this authentication against the
CDP facilitator in Python (`lore/payments/coinbase.py`), and the JWT generation
approach transfers even though the language does not.

## Acceptance criteria

- [ ] Mainnet is opt-in and explicitly configured — never the default, never
      reachable by a missing environment variable falling back to it
- [ ] A payment settles on Base mainnet and the funds arrive at the configured
      address
- [ ] Test and mainnet configuration cannot be confused at a glance in the
      deployed Worker

## Notes

Deliberately last and deliberately blocked. Everything upstream is reversible;
this is not. Do not pull it forward for convenience.

Status is `ideation` rather than `in-review` because the approach genuinely
cannot be specified until `MON-002` has run and reported what the facilitator
contract actually looks like in practice.

Only relevant if the edge adapter is pursued past the MPP origin gate at all —
epic #25 makes MPP the launch rail and Cloudflare/x402 optional. If the adapter
is dropped, close this obsolete rather than building it.
