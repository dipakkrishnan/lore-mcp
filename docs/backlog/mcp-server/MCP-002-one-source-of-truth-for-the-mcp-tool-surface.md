---
id: MCP-002
title: Keep one source of truth for the MCP tool surface
priority: P1
effort: S
component: mcp-server
status: completed
related: [MON-003, MCP-001, XC-004, XC-008]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-26
---

## Problem

`discover` and `answer` are now declared twice, independently. `lore/mcp.py`
defines them in its `TOOLS` list — names, descriptions, JSON Schema, annotations
— and `lore/node/src/index.ts` declares its own versions with hand-written Zod
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

Decided 2026-08-03 (see Notes): accept the duplication and add a contract test
that fails when the two surfaces disagree, rather than a code generator or a
fetch-and-re-serve scheme. Compare tool names, required arguments, and
argument bounds across `lore/mcp.py`'s `TOOLS` list and
`lore/node/src/index.ts`'s Zod schemas, and run the comparison as a CI job in
`XC-004`'s workflow so drift fails a pull request rather than waiting for
`XC-008`'s live suite to notice it against a buyer.

## Acceptance criteria

- [x] A tool added, renamed, or given a new argument on one surface cannot ship
      without the other surface being updated or the check failing
- [x] `max_results` is consistent across both surfaces, or its absence at the
      edge is deliberate and documented
- [x] The disclosure language a buyer sees does not depend on which surface they
      reached

## Notes

Only bites if the Cloudflare edge adapter is pursued (`MON-003`). If the adapter
is dropped and MPP at the origin is the only paid path, there is one surface
again and this closes obsolete.

The cheap check is worth doing even before that decision — it costs little and
it fails loudly the moment someone edits one side.

Ideation pass on 2026-08-01: this item is the *contract* tier of the CI pipeline
mapped in `XC-004`'s notes. Whichever of the three options is chosen, the check
has to run in `XC-004`'s workflow on every pull request — a drift check nobody
runs is the same as no drift check. That argues further for the third option: a
comparison test is the only one of the three that is a CI job rather than a build
step. `XC-008`'s live suite is where an escaped divergence would first become
visible to a buyer, which is later and more expensive than failing a PR.

Prioritization pass 2026-08-01 held this at `P2` and left it `in-review` despite
having no blockers. What stops promotion is the approach, not the priority: it
still reads "unclear which direction is right; needs a decision before
implementation", and the three options differ enough (codegen vs. fetch-and-
re-serve vs. comparison test) that handing this to implementation as-is would be
handing over the decision too. Pick one — the notes above argue for the
comparison test — and it is `ready` immediately at roughly `S`.

**Prioritization pass 2026-08-03:** made the decision the 2026-08-01 pass
deferred — comparison test, per its own reasoning above (only option that's a
CI job, not a build step). Corrected `effort` to `S` and promoted to `P1` /
`ready`.

**Implementation, 2026-08-06:** `max_results` no longer exists on either
surface — `MCP-001`'s manifest-first rework (`discover` returns the full free
catalog, no pagination arg) landed on both `lore/mcp.py` and
`lore/node/src/index.ts` since this item's problem statement was written, so
that half of the divergence resolved itself rather than needing a fix.

What was still live: `get`'s description text had drifted — the Python copy
carried an extra clause ("because payment settles before lookup and...") the
Worker's did not. Standardized on the Worker's shorter wording (it's the
buyer-facing, already-deployed copy) and added `contracts/mcp_tools.json` as
the single canonical source for each tool's name, description, and required
arguments. `tests/test_mcp_contract.py` checks `lore.mcp.TOOLS` against it;
`lore/node/test/mcp-contract.test.ts` checks the Worker's real
`tools/list` response (via an in-process MCP client, same pattern as
`paid-path.test.ts`) against it — each surface verifies itself against the
shared file in its own existing CI job (`python-unit`, `node-component`), so
no new CI job was needed and drift on either side fails that side's own PR
check. `tsconfig.json` gained `resolveJsonModule: true` so the Worker-side
test can import the JSON directly — the workerd sandbox `vitest-pool-workers`
runs tests in has no host filesystem access, so `readFileSync` isn't an
option there.

**Closed out (2026-08-26, audit/implementation pass):** the 2026-08-06
implementation note above already checked all three acceptance criteria,
but frontmatter had stayed `in-review`. Re-ran both contract tests against
current `main`: `tests/test_mcp_contract.py` passes standalone;
`lore/node/test/mcp-contract.test.ts` needed a local `LORE_WALLET` (the
gitignored `lore/node/.dev.vars`, same value `tests.yml` provisions in
CI) to run at all in this checkout — not a code issue, just local setup —
and passes once provisioned. Moving `in-review` → `completed`.
