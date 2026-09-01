---
id: MON-009
title: Decide whether publications need individual prices
priority: P2
effort: M
component: monetization
status: in-review
related: [MON-002, MON-003, MCP-001, APP-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-02
updated: 2026-08-28
---

## Problem

The node charges one owner-configured price for every `get(id)` call. That is
clear and safe, but it assumes every publication has equal value. Lore has no
evidence yet that sellers need finer control or that different prices would
help buyers decide.

Individual prices are also not a schema-only change: the current x402
`paidTool` registers one static price for `get` before its `id` argument is
handled. A row-level price cannot be advertised and charged truthfully without
first changing or replacing that payment seam.

## Proposed approach

Keep one global publication price through dogfood. Revisit only if owners
repeatedly cannot publish because materially different items need different
prices, or buyers repeatedly avoid useful multi-item purchases because every id
costs the same.

If that evidence appears, prove an input-dependent x402 price can be disclosed
before payment and enforced from the same value before changing storage or UI.
The first product shape would then be one optional per-publication override with
the global price as its default. Topics remain discovery metadata. Bundles,
subscriptions, discounts, and ownership accounting stay out until buyers show a
separate repeated need.

## Acceptance criteria

- [ ] Dogfood evidence records the concrete seller or buyer problem that one
      global publication price could not solve.
- [ ] A decision record either keeps the global price or chooses an optional
      per-publication override with a global default.
- [ ] Every offering exposes its exact price before payment, and the advertised
      price, payment requirement, and buyer spend cap derive from one value.
- [ ] Before implementation, a focused payment-contract test proves the chosen
      x402 seam can charge the validated `id`-specific price.
- [ ] The decision states what happens when an override is removed and when a
      publication changes or is revoked.
- [ ] Topic pricing, bundles, subscriptions, discounts, and ownership tracking
      remain explicitly out of scope unless separately validated.

## Notes

Answer pricing is already a separate global setting with per-job cost
telemetry; it is not blocked on this publication-pricing decision. Current
recommendation: keep the single global publication price until observed use
proves otherwise.
