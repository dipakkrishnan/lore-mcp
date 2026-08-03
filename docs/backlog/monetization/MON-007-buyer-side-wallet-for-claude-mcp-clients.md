---
id: MON-007
title: Let a Claude MCP client complete a paid x402 purchase with its own wallet
priority: P2
effort: M
component: monetization
status: in-review
related: [MON-002, MON-005]
blockers: []
dependencies: ["A worked example: an owner with a live node and a friend willing to test buy-side"]
github_issue: null
created: 2026-08-03
updated: 2026-08-03
---

## Problem

`discover` works from any MCP client, including a stock Claude Desktop/Code
connection added with `claude mcp add --transport http` — it's a free tool
call. But `get` is x402-paid: called without payment it returns a normal MCP
tool result whose content says payment is required (price, address, network),
and a plain Claude client has no wallet or signing capability to act on that.
It just sees the error and stops.

The only working buyer path today is `lore/node/scripts/pay.ts` (or the split
`discover.ts`/`buy.ts` pair prototyped ad hoc while walking an owner's friend
through testing a deployed node) — a standalone Node script holding a raw
private key, run outside any agent entirely. That means no real buying agent
(another person's Claude) can autonomously discover -> pay -> retrieve from a
lore node without leaving the agent and running a separate script by hand.
Every node deploy proves the rail against a script buyer, never against an
actual agent client doing what epic #25's target buyer flow describes.

## Proposed approach

Unclear in detail — needs investigation before it can be specified honestly.
The core question: what's the minimum wallet-signing capability that can be
handed to a Claude MCP client such that a paid `get` call completes, without
the private key ever entering the LLM's context or transcript?

Candidate shapes worth evaluating:
- A local signing MCP server the buyer runs alongside the remote lore-node
  connection — it holds the key, exposes a tool (or wraps `callTool`) that
  constructs and signs the x402 payment payload, and the model only ever sees
  "payment required" -> "paid" as tool results, never key material.
- Whether an existing wallet/agent-payment integration (e.g. Coinbase's agent
  tooling) already exposes something x402-shaped that a Claude MCP config can
  point at, rather than building a bespoke signer.
- Packaging today's `buy.ts` logic as an MCP tool server instead of a CLI
  script, so `claude mcp add` is the only setup step a buyer needs.

This is buyer-side tooling and likely lives outside `lore/node/` (which is the
seller-side Worker) — possibly its own package, or a `lore/node/scripts/`
sibling promoted to a real MCP server. Scope that decision during
investigation rather than assuming it belongs in this repo at all.

## Acceptance criteria

- [ ] A documented way exists for someone using Claude (Desktop or Code) to
      plug in a wallet/signer alongside a remote x402 lore-node MCP
      connection, without ever pasting a private key into the conversation
- [ ] That Claude client completes `discover` -> `get` -> paid retrieval
      against a live node end to end, entirely through MCP tool calls
- [ ] The settlement receipt (`_meta["x402/payment-response"]`) is visible to
      the buyer through the normal conversation, not just in a script's stdout
- [ ] The private key at no point appears in the model's context window or
      any transcript

## Notes

Surfaced 2026-08-03 while walking an owner through `lore-enable-payments`:
they deployed a node, proved the rail with the script buyer, then wanted a
friend to test the full flow and asked whether their friend's Claude could
just call it directly. Answer at the time: only for the free half.

Stay on Base Sepolia / test facilitator for any prototyping here — this item
does not touch the mainnet cutover in `MON-005`.
