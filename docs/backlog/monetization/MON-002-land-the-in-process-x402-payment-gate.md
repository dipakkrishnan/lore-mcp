---
id: MON-002
title: Land the in-process x402 payment gate with the Coinbase facilitator
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-001, MON-003, STO-001, XC-002, XC-004]
blockers: []
dependencies:
  - "Coinbase CDP account with x402 API keys"
  - "x402 and cdp Python packages (payment-only runtime deps; pydantic arrives earlier via PR #19)"
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

`lore price` stores a price and `discover` advertises it, but nothing charges it.
`answer` returns owner-approved content to anyone who can reach the endpoint,
regardless of the advertised price. So the entire monetization half of the product
is currently a number in a settings table.

`MON-001` was the plan for closing that gap at the edge, via Cloudflare's
Monetization Gateway. It was closed obsolete on 2026-07-29 — payment moves
in-process to the MCP layer instead. That decision left no item covering the work
that replaces it.

There is a substantially complete implementation on `origin/codex/x402-payments`
that has never been reviewed or merged: an in-process x402 gate on the `answer`
tool, verified and settled through Coinbase's hosted CDP facilitator, paid in USDC
on Base. It needs landing, and it needs two changes before it is usable by a human.

## Proposed approach

Review, revise, and land that branch. What is already there:

| File | What it provides |
|---|---|
| `lore/payments/__init__.py` | `gate(price_usd, handler)` — `None` when free, validates the price, else builds the gate |
| `lore/payments/config.py` | `PaymentConfig` — four env vars, Base/Base-Sepolia allowlist, EVM address validation, `validate_paid()` |
| `lore/payments/coinbase.py` | `CoinbaseAuth` — short-lived CDP JWTs; the hosted facilitator client |
| `lore/payments/x402.py` | `gate()` — the `exact` EVM scheme, wrapping `answer` at `mcp://tool/answer` |

Four changes it needs, per `docs/enable-payments.md`:

1. **A settings-backed configuration path.** `CONFIG = PaymentConfig()` is a
   module-scope singleton populated from `os.environ` at import. As written, a
   pay-to address that `MON-003`'s skill persists into Lore has no effect, and the
   owner must export environment variables by hand — which is most of the friction
   the skill exists to remove. Resolve pay-to and network from settings when the
   environment does not supply them; environment wins where both are present.
2. **A dependency decision.** PR #19 already introduces `pydantic` for the store
   models, so the README's "no dependencies beyond Python 3.10+ and SQLite" claim
   breaks at that merge — before this item. `x402` and `cdp` are the additional
   payment-only packages; the installer decision covers both, and the payment
   imports must stay lazy enough that an owner who never monetizes never needs
   them.
3. **A credential command.** The branch reads the CDP secret from the environment
   only. The owner-facing path is a command (proposed: `lore payment auth`) that
   prompts with echo off and writes a `0600` file under `$LORE_HOME` — so the
   secret never transits an agent conversation (see `MON-003`).
4. **A buyer harness.** Nothing in the branch can *pay*. A minimal x402-capable
   client (proposed: `lore payment test-buy`) driven by a second testnet wallet is
   what makes `MON-003`'s test transaction runnable at all.

Plus the failure-mode hardening the branch does not cover: a price greater than
zero with incomplete payment configuration must fail loudly at server start rather
than on the first buyer's call, and `validate_paid()` should name the missing item
in owner-facing terms rather than only the environment variable.

## Acceptance criteria

- [ ] `answer` returns an in-band payment-required challenge with x402
      requirements when a price is set (at the MCP layer — not an HTTP status),
      and owner-approved content after a verified payment
- [ ] `discover` stays free and ungated
- [ ] The payment challenge discloses no publication content
- [ ] A credential command prompts for the CDP key id and secret with echo off and
      writes the `0600` file; no skill or agent path inputs the secret
- [ ] A minimal buyer harness performs challenge → pay → retry as an x402 client
      against a local node on Base Sepolia
- [ ] A price of `0` or unset means no gate is constructed at all, and adds no
      latency to `discover`
- [ ] Pay-to address and network resolve from Lore settings when absent from the
      environment; environment values win when both are present
- [ ] A price greater than zero with incomplete payment config fails at server
      start, naming the missing item in owner-facing terms
- [ ] `x402`/`cdp` imports are lazy — an owner who never sets a price never needs
      the packages installed
- [ ] The README's dependency claim and the installer reflect whatever the
      dependency decision turns out to be
- [ ] A paid answer and a free answer read from exactly the same
      `publications WHERE active=1`; payment never widens the disclosable set
- [ ] Tests cover the gate against a stubbed facilitator, with no network calls and
      no real funds

## Notes

Design in `docs/enable-payments.md`. This item is the mechanism; `MON-003` is the
owner-facing skill that configures it, and is blocked by this.

`MON-001` is `related` rather than superseded-by, because its closure note is the
record of *why* this is in-process rather than at an edge gateway. Read it first.

Two things this deliberately does not do: no dynamic pricing (one fixed price, which
is what the `402` challenge already quotes), and no repeated-query extraction
protection. The latter is a real threat the README names — a buyer paying
repeatedly to reconstruct private material — and bounded publications remain the
only current mitigation. Landing payment does not improve it, and arguably makes it
more urgent.

Note the branch predates PR #19, so it will need reconciling against the retirement
of `pending`/`external` and the move of the MCP read path onto `publications`.

Two accepted risks recorded here: (1) verify-then-settle has a window where
settlement succeeds and answer production then fails — the buyer paid for nothing;
accepted for the MVP since the answer is a cheap read of pre-approved content.
(2) Where this gate runs for a *deployed* node is unresolved (`XC-004`); this item
lands the local path only and assumes nothing about deployment.
