---
id: MON-001
title: Write a deployment guide for the Cloudflare Tunnel / Monetization Gateway path
priority: P2
effort: L
component: monetization
status: obsolete
related: []
blockers: []
dependencies: []
github_issue: null
created: 2026-07-25
updated: 2026-07-29
---

## Problem

`lore/mcp.py`'s module docstring and the `answer` tool's description both
describe the intended production path (`buyer -> Cloudflare Tunnel ->
Monetization Gateway/x402 -> Lore /mcp`), and `lore price` already lets an
owner set `price_usd`. But there's no guide or reference config anywhere in
the repo for actually standing up that path — an owner who wants to monetize
external memories has no concrete steps to follow past running `lore serve
--transport http` on loopback.

## Proposed approach

A `docs/` guide (or a doc under `monetization/` once specifics are known)
covering: exposing the loopback HTTP origin only to a Cloudflare Tunnel,
configuring the Monetization Gateway / x402 offer in front of it, and how
`price_usd` and the `external` status map to what the gateway should charge
for. Needs a decision on how prescriptive to be (fully worked example vs.
pointers to Cloudflare's own docs) before it's ready to implement — that's
why this stays `in-review` rather than `ready`.

## Acceptance criteria

- [ ] A written guide exists covering tunnel setup, gateway/x402
      configuration, and how they connect to `price_usd`/`external` status
- [ ] The guide is linked from wherever pricing is documented (README and/or
      CLI help)

## Notes

Filed while building the backlog system itself, as a seed item demonstrating
a larger, `in-review` item with an external dependency.

**Closed obsolete 2026-07-29 (Shane).** Lore is not going to use Cloudflare.
Every artifact this item was meant to document has been removed: PR #19 strips
Cloudflare and x402 from `lore/mcp.py` and the README, replacing them with a
vendor-neutral description of where a payment boundary would sit. The `external`
memory status the guide was going to map prices onto is also retired in that PR
— disclosure now happens only through owner-approved publications.

Nothing here transfers to a different provider, because the whole item was the
specifics of one: tunnel setup, gateway enrollment, x402 offer configuration.
If a payment gateway is chosen later, that wants a fresh `MON` item written
against whatever it actually is. The parts worth keeping are already elsewhere:
pricing lives with `lore price`, and disclosure policy is `XC-002`.

Kept rather than deleted so the decision and its reasoning stay in the record.
