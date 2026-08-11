---
id: MON-013
title: Surface unpushed publication drift between the local library and the deployed node
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-004, MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-10
updated: 2026-08-10
---

## Problem

Approving a publication locally does not reach the deployed node until the
owner remembers to run `lore push` separately. Nothing in `lore status` (or
anywhere else) compares the local active-publication count against what the
deployed node is actually serving, so the gap is invisible until an outside
buyer notices — which is exactly what happened: an owner published three new
items, `lore status` kept showing them as active, and a third party trying to
buy from the node reported he couldn't see them at all. The owner had no way
to catch this themselves short of manually querying the live `discover` tool.
`MON-004` already covers the mirror-image case (revocation not reaching the
edge fast enough); this is the same underlying drift problem for the
publish/new-content direction, which no existing item covers.

## Proposed approach

Unclear in detail. One shape: `lore status` fetches (or caches from the last
push) the deployed node's publication count/ids and diffs against the local
active set, printing something like `Node catalog: 2 pushed, 3 pending push`
when they disagree. A stronger shape: auto-push as part of the publish/approve
flow itself, so the gap never opens rather than needing to be surfaced.

## Acceptance criteria

- [ ] After approving a publication without running `lore push`, some
      owner-visible signal (most likely `lore status`) shows the deployed
      node is behind the local active set
- [ ] The signal disappears once `lore push` runs and the sets match

## Notes

Surfaced 2026-08-10: local active-publication count was 5, the deployed
node's live `discover` catalog still reported 2, and the gap was only found
by directly querying the node's MCP endpoint after a third-party report — not
through any owner-facing tooling.
