---
id: MON-010
title: Test the Worker's paid path against a mocked facilitator
priority: P1
effort: M
component: monetization
status: completed
related: [MON-002, MON-003, MON-007, MON-008, XC-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-01
updated: 2026-08-03
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

- [x] The paid `answer` handler executes in an automated test with a stubbed
      facilitator and returns publication content — no network, no wallet, no
      faucet funds
- [x] An invalid credential and a replayed credential each fail closed: the tool
      handler is never invoked and no content is returned
- [x] A facilitator that 5xxs or times out fails closed rather than serving
      content unpaid
- [x] `discover` returns titles and topics only — a test fails if publication
      `content` ever appears on the free surface
- [x] The suite runs with `npm test` in `lore/node/`, needs no credentials, and is
      wired into the CI workflow `XC-004` creates
- [x] The facilitator URL is configurable via `env` and still defaults to
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

Renumbered from `MON-007` to `MON-010` on 2026-08-03: this was filed as `MON-007`
on 2026-08-01, and PR #63 independently took that id on `main` for the buyer-side
wallet item while this branch was open. Same resolution as the earlier renumber
around the ids PR #32 took. Nothing in the item changed but the number.

Not to be confused with the `MON-007` that now holds that id — that one is about
a *buyer* completing a purchase from inside an agent. This is about the *seller*
side proving its paid path without spending anything. They meet at the same
handler from opposite directions, which is worth remembering when either
changes.

## Implementation notes (2026-08-03)

Implemented as scoped: `@cloudflare/vitest-pool-workers` runs `lore/node`'s
tests in `workerd` against real Durable Object and local D1 bindings; only
`globalThis.fetch` calls to the facilitator origin are mocked
(`test/facilitator.ts`), via `vi.spyOn`, not the newer `fetchMock` API this
package version doesn't export. `vitest.config.ts` points every test at a
fixed stub URL (`https://facilitator.test`, overriding `LORE_FACILITATOR_URL`
through `miniflare.bindings`); each test varies the *response* the stub
returns rather than the URL, since only one override is needed for the whole
suite.

The Worker's paid tool is named `get`, not `answer` — the acceptance criteria
above predate that naming and were left as written; "the paid `answer`
handler" refers to the same thing.

`settle-then-vanish` (settlement succeeding on-chain but the response being
lost) from the Proposed approach is out of scope here: nothing in the current
handler could behave differently for it, since there is no idempotency
tracking to exercise (that gap is what `MON-002`'s Problem section flags as
still open, not something this item was asked to fix). What's covered instead
is the strictly-weaker "settle call fails outright" case (`http-error`), which
does exercise a real code path — settle failing after a successful verify
returns `SETTLEMENT_FAILED` rather than content, even though `cb` already read
the row from D1.

Buyer credentials are throwaway `viem` keys generated per test
(`generatePrivateKey()`) and never touch a real chain — the same client
machinery `scripts/pay.ts` uses, but with `x402Client`/`registerExactEvmScheme`
driven directly instead of through `withX402Client`, so a "replay" test can
capture and resubmit the exact same signed token across two calls.

Local repro note for future readers: `npm run types` regenerates `env.d.ts`
from `.dev.vars` when present — CI creates `.dev.vars` with a burn-address
`LORE_WALLET` before running `types`, so run the same locally before
regenerating, or `LORE_WALLET` silently drops out of the generated `Env`.
