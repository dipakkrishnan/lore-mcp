---
id: MON-007
title: Let a Claude MCP client complete a paid x402 purchase with its own wallet
priority: P2
effort: S
component: monetization
status: in-review
related: [MON-002, MON-005]
blockers: []
dependencies: ["A worked example: an owner with a live node and a friend willing to test buy-side"]
github_issue: null
created: 2026-08-03
updated: 2026-11-13
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

- [x] A documented way exists for someone using Claude (Desktop or Code) to
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

**Review 2026-10-19:** not completed. Bridge code complete (b0f9e24 and follow-ups). Unverified: a live discover -> get -> paid retrieval against a node end to end.

**Prioritization (2026-11-12):** Priority P2, effort S (was M). Stays in-
review. Before it can be ready: Code is complete. A person runs Claude
Desktop or Code with the bridge against a live node (discover, then a paid
get) and confirms the receipt shows in the conversation and the private key
never enters the context. Prioritization flag (not acted on): done (code).

**Close-out (2026-11-13):** Stays in-review. The bridge is built:
`bridge/src/index.ts` (PR #71, b0f9e24, with later policy tests in #616 and
bid tools in #620) is a local stdio MCP server that holds the signer
(`X402_PRIVATE_KEY` or a self-provisioned `~/.x402-bridge/key.env`), pays a
402 with `withX402Client`, and appends "x402 settlement receipt: …" to the
tool result. `bridge/README.md` documents `claude mcp add lore-buyer -- …`
with no key in the conversation, so criterion 1 is ticked. Criteria 2-4 need
the live run nobody has done yet: a person adds the bridge to Claude Desktop
or Code, runs `discover` then a paid `get` against a live node, and confirms
the receipt shows in the conversation and the key never appears in the
context or transcript. Nothing to build.
