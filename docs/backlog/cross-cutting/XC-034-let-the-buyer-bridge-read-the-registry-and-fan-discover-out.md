---
id: XC-034
title: Let the buyer bridge read the registry and fan discover out
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-033, XC-022, MON-007, MCP-001]
blockers: [XC-033]
dependencies: []
github_issue: null
created: 2026-09-15
updated: 2026-09-15
---

## Problem

The bridge connects to exactly one node (`bridge/src/index.ts`), so a buyer
adds one MCP entry per seller and learns each node's network out of band.
With a registry the buyer's agent should ask one question, "who sells
about X", and buy from whichever node answers.

## Proposed approach

A `--registry` flag taking the raw URL of `marketplace.json` (default: the
public repo's `main`). On start the bridge reads it, keeps the sellers on
its own network, and exposes one `discover` that fans out to each node's
`discover` and returns a merged catalog with the seller's name and node on
every entry. `get` and `answer` route to the node that owns the id. The
per-process spend cap becomes the cap across all sellers, closing the "N
sellers is N times the exposure" note in `XC-022`. Nodes that fail to answer
are skipped with one line in the log, not an error to the buyer.

## Acceptance criteria

- [ ] With the registry flag and no node flag, `discover` returns entries
      from every live node on the bridge's network, each attributed.
- [ ] `get` on any returned id settles against the right node.
- [ ] A node on the other network is excluded before any payment.
- [ ] The spend cap holds across sellers in one process.

## Notes

Personal agents that cannot run the bridge read the raw file directly; a
hosted MCP over the registry is the later step, not this one.
