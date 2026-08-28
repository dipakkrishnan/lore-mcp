---
id: MON-011
title: Verify the Worker is actually running newly deployed code, not a warm stale instance
priority: P2
effort: S
component: monetization
status: ready
related: [MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-10
updated: 2026-08-26
---

## Problem

`lore node deploy`'s smoke check confirms the node is *reachable*, not that
it is running the *newly uploaded* code. In one observed case, after a
successful `wrangler deploy` (new version id confirmed via `wrangler
deployments list`) the live `LorePaidMCP` Durable Object kept returning the
previous deployment's `serverInfo.name` and network config for roughly a
minute afterward — a warm in-memory instance apparently continues running
whatever code it loaded until it naturally cycles, even though the script
behind it has already changed. `lore node deploy` reported success the whole
time. An owner (or agent) checking behavior immediately after a deploy can
reasonably conclude a config change didn't take effect and start
troubleshooting the wrong thing.

## Proposed approach

Unclear in detail — needs investigation into what signal reliably
distinguishes "new code uploaded" from "new code actually serving requests"
for a Durable-Object-backed Worker. One shape: the smoke check polls a
value that only the new code can produce (e.g. a version string embedded at
build time) with a short retry/backoff window, and reports "deployed, still
propagating" rather than bare success if it never observes the new value
within that window.

## Acceptance criteria

- [ ] The deploy smoke check can distinguish "reachable" from "serving the
      version just deployed"
- [ ] If the new version hasn't taken effect within a reasonable window, the
      command says so explicitly rather than reporting plain success

## Notes

Surfaced 2026-08-10 during a mainnet cutover: repeated `curl` calls against
`/mcp` immediately post-deploy kept returning the pre-deploy `serverInfo.name`
across three separate `wrangler deploy` runs (each confirmed as a genuine new
version via `wrangler deployments list`), then flipped to the correct value
on a later, unrelated retry. No code change was needed to fix it — only time
passing — which is exactly the kind of false negative this item is about
catching or explaining rather than leaving to guesswork.

**Prioritization pass 2026-08-26:** No blockers; "unclear in detail" names a concrete shape (poll a build-time version string with backoff) that's enough to start from. Promoted `in-review` → `ready`.
