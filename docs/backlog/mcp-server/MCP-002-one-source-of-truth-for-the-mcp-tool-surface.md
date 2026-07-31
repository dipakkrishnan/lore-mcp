---
id: MCP-002
title: Keep one source of truth for the MCP tool surface
priority: P2
effort: M
component: mcp-server
status: in-review
related: [MON-003, MCP-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

`discover` and `answer` are now declared twice, independently. `lore/mcp.py`
defines them in its `TOOLS` list — names, descriptions, JSON Schema, annotations
— and `worker/src/index.ts` declares its own versions with hand-written Zod
schemas and separately written descriptions.

Nothing keeps them in agreement. A buyer's agent reads whichever surface it
connected to, so the two can advertise different argument names, different
limits, or different disclosure language while both look correct in isolation.
They have already diverged: the Worker omits `max_results`, which the Python
surface accepts and validates as an integer from 1 to 10.

This gets worse, not better, as both sides move — `MCP-001` reshapes discovery
around a browsable publication tree, and `MON-003` makes the Worker serve real
content.

## Proposed approach

Unclear which direction is right; needs a decision before implementation.

The options are roughly: generate the Worker's tool declarations from a shared
schema file that both sides read; or declare the tools once in the Python origin
and have the Worker fetch and re-serve that declaration; or accept the
duplication and add a test that fails when the two surfaces disagree.

The third is the cheapest and may be sufficient — a contract test comparing tool
names, required arguments, and argument bounds across both surfaces catches
drift without building a code generator for two tools.

## Acceptance criteria

- [ ] A tool added, renamed, or given a new argument on one surface cannot ship
      without the other surface being updated or the check failing
- [ ] `max_results` is consistent across both surfaces, or its absence at the
      edge is deliberate and documented
- [ ] The disclosure language a buyer sees does not depend on which surface they
      reached

## Notes

Only bites if the Cloudflare edge adapter is pursued (`MON-003`). If the adapter
is dropped and MPP at the origin is the only paid path, there is one surface
again and this closes obsolete.

The cheap check is worth doing even before that decision — it costs little and
it fails loudly the moment someone edits one side.
