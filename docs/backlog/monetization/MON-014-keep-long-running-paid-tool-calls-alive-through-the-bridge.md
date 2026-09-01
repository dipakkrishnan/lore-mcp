---
id: MON-014
title: Keep long-running paid tool calls alive through the bridge
priority: P2
effort: S
component: monetization
status: obsolete
related: [MON-007, MCP-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-17
updated: 2026-08-28
---

## Problem

The x402-mcp-bridge sits between every buyer client and a seller node, which
makes it the weakest timeout in the chain. MCP clients default to roughly 60
seconds per tool call, reset only by progress notifications. Today every node
tool returns in seconds, so nothing exposes this — but the answer tier
(`MCP-003`) introduces calls backed by an agent loop, and even its fast paths
(a slow `result` poll) can exceed a strict default on a cold
node. If the bridge swallows progress notifications or applies its own tight
timeout, buyer clients will die mid-call no matter how well the node behaves,
and on a *paid* call that is money spent for a transport failure.

## Proposed approach

Audit the bridge's proxying of MCP notifications end to end: forward server
progress notifications to the buyer client unchanged (so compliant clients
reset their per-request timeout), and set the bridge's own client-side
timeout generously (or resettable-on-progress) rather than inheriting the
default. Add a regression test that drives a slow mock node (tool call that
takes > 60s while emitting progress) through the bridge and asserts the call
completes. Document the behavior for hosted clients (claude.ai remote MCP)
that are less forgiving than CLI clients — the ticket-based contract in
`docs/answer-tier.md` §7 is the mitigation there.

## Acceptance criteria

- [ ] A tool call that takes longer than the MCP client default timeout, with
      the node emitting progress notifications, completes through the bridge.
- [ ] The bridge does not impose a tighter timeout than the buyer's client;
      its own timeout is configurable or progress-resettable.
- [ ] A regression test covers the slow-node-with-progress path.

## Notes

Filed 2026-08-17 out of the answer-tier design (`docs/answer-tier.md` §7).
Independently shippable ahead of `MCP-003` — it hardens today's paid `get`
path against slow cold starts too — so it is related to `MCP-003`, not a
blocker of it.

**Prioritization pass 2026-08-26:** No blockers — explicitly independently shippable ahead of `MCP-003`, and hardens today's paid `get` path too. Promoted `in-review` → `ready`.

**Closed 2026-08-28:** the shipped answer contract makes the paid call return a
ticket immediately, while free `result` polling performs a bounded D1 read.
Neither path needs a tool call held open for the agent's runtime, and no observed
`get` timeout justifies generic bridge keep-alive machinery. Reopen as a new,
measured transport bug if a real client times out on a bounded call.
