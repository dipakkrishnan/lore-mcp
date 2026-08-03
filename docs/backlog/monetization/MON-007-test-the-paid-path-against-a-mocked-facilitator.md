---
id: MON-007
title: Test the Worker's paid path against a mocked facilitator
priority: P1
effort: M
component: monetization
status: ready
related: [MON-002, MON-003, MON-008, XC-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-01
updated: 2026-08-01
---

## Problem

The Worker's paid handler has never run in any automated test. `lore/node/scripts/
smoke.ts` asserts the *unpaid* path only — tools are listed, `discover` is free,
`answer` returns an `x402/error` challenge — and its own header says it "is not
wired into CI". Everything past the 402 is unproven except by hand.

The reason it stays unproven is that the facilitator is hardcoded to a live
third-party service: `lore/node/src/index.ts` sets `facilitator: { url:
"https://x402.org/facilitator" }`. Any test that exercises verification or
settlement leaves the machine, needs a funded wallet, and spends faucet money —
so there is no cheap, repeatable way to assert the paid path at all, and the
failure modes that matter most cannot be reached deliberately:

- a credential that is invalid, expired, or replayed
- the facilitator returning 5xx, or timing out mid-settlement
- settlement succeeding but the response being lost (the double-charge question
  `MON-002` raises and the canary has no idempotency handling for)

These are exactly the paths that must fail closed, and none of them can be
provoked against a real facilitator on demand.

## Proposed approach

Add `@cloudflare/vitest-pool-workers` to `lore/node/` so tests run in `workerd`
with real bindings — a real Durable Object and a real local D1 — and mock only
what crosses the network.

1. **Make the facilitator injectable.** Read its URL from `env` with the current
   `https://x402.org/facilitator` as the default, so tests point it at a stub
   without changing deployed behaviour. This is the one production change the
   item needs.
2. **Stand up a facilitator stub** that can be told what to return: verified,
   rejected, 5xx, timeout, and settle-then-vanish.
3. **Seed local D1** with fixture publications so `discover` and `answer`
   assertions run against known rows rather than an empty table.
4. **Write the cases** against the MCP surface, not the internals — connect a
   client the way `smoke.ts` does and assert on what a buyer would see.

`smoke.ts` stays what it is: an unpaid health check to run against a real
deployment. This item does not replace it, and does not need it to change.

## Acceptance criteria

- [ ] The paid `answer` handler executes in an automated test with a stubbed
      facilitator and returns publication content — no network, no wallet, no
      faucet funds
- [ ] An invalid credential and a replayed credential each fail closed: the tool
      handler is never invoked and no content is returned
- [ ] A facilitator that 5xxs or times out fails closed rather than serving
      content unpaid
- [ ] `discover` returns titles and topics only — a test fails if publication
      `content` ever appears on the free surface
- [ ] The suite runs with `npm test` in `lore/node/`, needs no credentials, and is
      wired into the CI workflow `XC-004` creates
- [ ] The facilitator URL is configurable via `env` and still defaults to
      `https://x402.org/facilitator` when unset

## Notes

This is the "mocked endpoints" tier of the CI pipeline: everything the Worker
does except the parts that genuinely require a chain. The live-money equivalent
is `MON-008` (a standing testnet deployment) and `XC-008` (running against it);
this item is what makes those two cheap to trust, because by then only the
facilitator and the chain are still unproven.

Ordering against `MON-002`: they can run in either order and inform each other.
`MON-002` observes what the real facilitator actually does; this item pins that
behaviour as fixtures. If `MON-002` runs first, its findings should become the
stub's default responses rather than guesses.

Making the facilitator URL configurable is deliberately scoped to a default-
preserving `env` read. It is *not* the mainnet facilitator work — that is
`MON-005`, which also needs authentication and must stay opt-in.
