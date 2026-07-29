---
id: MON-001
title: Write a deployment guide for the Cloudflare Tunnel / Monetization Gateway path
priority: P2
effort: L
component: monetization
status: in-review
related: []
blockers: []
dependencies: ["Cloudflare account with Tunnel + Monetization Gateway access"]
github_issue: null
created: 2026-07-25
updated: 2026-07-25
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
