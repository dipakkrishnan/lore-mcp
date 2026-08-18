---
id: XC-016
title: Let a buyer reach a seller they were never introduced to
priority: P3
effort: L
component: cross-cutting
status: in-review
related: [MCP-001, MON-007, XC-006]
blockers: []
dependencies: ["Evidence of demand: several live nodes, and a buyer who wants one they were not handed"]
github_issue: null
created: 2026-08-06
updated: 2026-08-06
---

## Problem

A buyer can only reach a node whose URL someone handed them out of band. The
bridge connects to exactly one remote (`bridge/src/index.ts:106`), so every
seller is a separate hand-added MCP entry, and the buyer must also learn the
node's network out of band — a Sepolia node and a mainnet bridge fail only at
settlement time. That is workable between two people who already know each
other and is not a market: there is no way to answer "who is selling lore
about X?" without already knowing the answer. `MCP-001` covers discovery
*within* a node once you have its URL; nothing covers finding the node.

## Proposed approach

Unclear — needs investigation, and deliberately not now. Three shapes worth
evaluating when demand exists:

- **A registry.** A hosted index sellers opt into, queryable by topic. Most
  useful, most work, and it re-centralizes a system whose whole argument is
  that the seller keeps custody.
- **Node self-advertisement.** `.well-known` on the seller's domain, or a DNS
  TXT record, so a node is discoverable from a domain the seller already owns
  with no central party. Solves "verify this node is really Shane's" better
  than a registry does; solves "find someone selling X" not at all.
- **List in the public MCP server registry.** Cheapest by far, reuses an
  existing directory, and inherits whatever reach it has.

These are not exclusive: self-advertisement is the trust primitive, a
registry or the MCP directory is the search layer over it.

## Acceptance criteria

Shape-agnostic, so they survive whichever is chosen:

- [ ] A buyer who has never been given a URL can find a node by topic and
      complete a purchase without hand-editing MCP config
- [ ] The node's network is discoverable before payment, so a testnet node and
      a mainnet buyer fail loudly at connect rather than silently at settlement
- [ ] Listing is explicit seller opt-in; an unlisted node stays unlisted
- [ ] Nothing beyond what `discover` already serves publicly is advertised —
      no private memory, no owner identity the owner did not choose to attach

## Notes

Filed 2026-08-06 after the first live mainnet purchase, while setting up a
second-person buy test. Getting a friend's node into the buyer's client
required exactly one piece of information (the `/mcp` URL) plus an out-of-band
check of which network they deployed on — small enough to prove the gap is
real without being urgent.

Deliberately deferred. A registry holding two nodes is worse than a DM, and
the current bottleneck is that no stranger has bought anything yet. Building
search before there is anything to search for is the expensive mistake this
item exists to avoid making. Revisit when the dependency above is met.

Related buyer-side constraint worth folding into whatever shape wins: one
bridge process is one node, and every process shares
`~/.x402-bridge/key.env` unless `X402_PRIVATE_KEY` overrides it. So a buyer
funds one wallet and can buy from many sellers, but `--max-usd` is per
process — caps do not aggregate across sellers, and N sellers is N times the
intended exposure.
