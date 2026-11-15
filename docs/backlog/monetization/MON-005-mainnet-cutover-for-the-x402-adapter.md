---
id: MON-005
title: Cut the x402 edge adapter over to mainnet
priority: P3
effort: XS
component: monetization
status: obsolete
related: [MON-002, MON-003, MON-004]
blockers: [MON-002, MON-003, MON-004]
dependencies: ["CDP account and API credentials", "Decision to launch the edge adapter at all"]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/25
created: 2026-07-30
updated: 2026-11-13
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

- [x] Mainnet is opt-in and explicitly configured — never the default, never
      reachable by a missing environment variable falling back to it
- [ ] A payment settles on Base mainnet and the funds arrive at the configured
      address
- [x] Test and mainnet configuration cannot be confused at a glance in the
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

**Prioritization pass 2026-08-26:** all three formal `blockers` (`MON-002`,
`MON-003`, `MON-004`) are now `completed`. Deliberately not promoting to
`ready` anyway — this is the one irreversible step in the whole payment
chain (real money, real disclosure to strangers), the item's own Notes say
"do not pull it forward for convenience," and the two real gates (CDP
credentials, and the standing decision to launch the edge adapter at all)
are exactly the kind of human calls a mechanical blocker check can't clear.
Left `in-review`.

**Review 2026-10-19:** not completed. Mainnet is opt-in and labelled (21e7865). Unmet: a real payment settling on Base mainnet to the configured address. Needs a live run by a human.

**Prioritization (2026-11-12):** Priority P3, effort XS (was M). Stays in-
review. Before it can be ready: No code left. A person runs one real Base
mainnet payment and confirms it lands at the configured address; this is the
same 1-cent check as MON-025. Prioritization flag (not acted on): duplicate
of MON-025's live check.

**Close-out (2026-11-13):** Obsolete, superseded and a duplicate. The
item's premise, cutting over through Coinbase's CDP facilitator with JWT
credentials as Worker secrets, was replaced by MON-025 (#339) and MON-042
(#422): real-money stores settle keyless through PayAI
(`KEYLESS_FACILITATOR` in `lore/node/src/network.ts`), and a full CDP pair is
only an optional override. The two code criteria hold and are ticked:
`network()` falls back to Base Sepolia and only takes `eip155:8453` when
`LORE_NETWORK` spells it out (`lore/node/test/unit/network.test.ts`), and
`networkLabel()` names the server "Lore x402 (MAINNET)" or "(test)"
(`lore/node/src/index.ts`). The only open criterion, a real Base mainnet
payment landing at the configured address, is the same live check as
MON-025's 1¢ real-money purchase criterion. MON-025 is the surviving item.
