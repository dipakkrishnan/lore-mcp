---
id: MON-002
title: Complete the Base Sepolia canary payment end to end
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-003]
blockers: []
dependencies: ["Funded Base Sepolia buyer wallet (faucet test USDC)", "Cloudflare account for deployment"]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/25
created: 2026-07-30
updated: 2026-07-30
---

## Problem

The x402 canary in `lore/node/` (PR #32) has never actually taken a payment.
`lore/node/scripts/smoke.ts` asserts only the *unpaid* path: that `answer` returns
`isError` with an `x402/error` meta. Verification and settlement — the two steps
that involve a facilitator and real (test) money — have never run. So the thing
the canary exists to prove is the one thing still unproven.

Epic #25 names this as a launch dependency in its own right: "a separate agent
completes free discovery -> 402 -> payment -> publication-only answer; invalid
payment and revocation fail closed."

## Proposed approach

Deploy the canary and run `lore/node/scripts/pay.ts` against it with a dedicated
Base Sepolia wallet funded from the CDP faucet. Confirm the settlement receipt
on-chain and confirm the recipient address actually received the test USDC.

Then extend the smoke test to cover what the manual run proved, so the paid path
does not go back to being untested: an invalid or replayed credential must fail
closed without reaching the tool handler.

This item covers the payment rail only. Serving real published content is
`MON-003` — the canary's hardcoded answer string is expected here and is not a
defect to fix in this item.

## Acceptance criteria

- [ ] A live Base Sepolia payment settles against the deployed canary, with the
      transaction confirmed on-chain and received at the configured address
- [ ] The receipt is returned to the buyer in `_meta["x402/payment-response"]`
- [ ] An invalid credential and a replayed credential both fail closed — no tool
      handler invocation, no settlement
- [ ] The smoke test covers the paid path, not only the 402 challenge
- [ ] Findings are written up where the next implementer will see them (worker
      README or this item's notes): facilitator behaviour, failure modes, latency

## Notes

Never use a mainnet wallet or mainnet USDC. `lore/node/scripts/pay.ts` caps spend
at `usdcBaseUnits(PRICE_USD)` — keep that cap.

Open question worth answering during the run: what the buyer sees when
settlement succeeds but the response is lost. Epic #25 requires "one answer and
one receipt without double charging on retries", and the canary has no
idempotency handling today.
