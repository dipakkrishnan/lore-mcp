---
id: MON-027
title: Walk the Tempo credits buyer path end to end before building MPP
priority: P2
effort: S
component: monetization
status: ready
related: [MON-026, XC-037, XC-022]
blockers: []
dependencies: ["v0.1.3 shipped", "First stranger buy on x402"]
github_issue: null
created: 2026-09-27
updated: 2026-09-27
---

## Problem

The buyer story for card-funded, non-custodial payments rests on Tempo's
MPP Credits: top up with a card or Apple Pay, and an agent pays a node's
402 from credits a cent at a time, with the seller receiving USDC. Nothing
about that has been walked by us. The largest unknown decides the whole
story: whether credits pay any MPP service, or only services Tempo lists or
proxies. If Tempo must approve each seller, credits do not work for Lore.

## Proposed approach

A one-day spike, timed and written up, no product code merged:

1. Sign up for Tempo Wallet as a new buyer. Note every step, any identity
   check a card top-up triggers, and the time taken.
2. Top up $5 with Apple Pay or a card. Note fees and minimums.
3. Connect the wallet to Claude Code through Tempo's CLI or MCP tool with a
   $2 spend limit.
4. On one node (Moderato, or Dipak's mainnet node), accept MPP beside x402
   with `mppx` inside the Worker's Durable Object MCP setup (MON-026 cut 1's
   unknown).
5. With the `lore-buy` skill, have the agent discover and buy three reads.

## Acceptance criteria

- [ ] A written walk-through: steps, time, fees, and screenshots of each
      buyer step
- [ ] A yes/no, with evidence, on whether credits pay an unlisted MPP service
- [ ] A yes/no on `mppx` working in the Worker beside x402, with the branch
- [ ] A recommendation: build MON-026 cut 1 now, change its shape, or drop it

## Notes

Decided Sep 27 2026: Lore does not hold money, so Stripe Billing with
Connect (a card billed monthly for aggregated reads) is out. Link fits
priced items around $2 and up (answers, bundles), not one-cent reads,
since each Link payment is a card charge ($0.50 minimum, 2.9% + 30¢) and
today needs the person's approval per request. Post-v0.1.3; the first buy
happens on x402.
