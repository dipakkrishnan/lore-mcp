---
id: MCP-001
title: Let buyers browse a publication metadata tree instead of only keyword-searching
priority: P2
effort: L
component: mcp-server
status: in-review
related: [STO-001, XC-002]
blockers: [XC-002]
dependencies: []
github_issue: null
created: 2026-07-29
updated: 2026-07-30
---

## Problem

`discover` is keyword-only: the buyer sends a query string, Lore runs FTS5 over
active publications and returns matching titles. That assumes the buyer already
knows the right vocabulary for someone else's lore. A buyer who doesn't know what
this node holds has no way to find out except guessing search terms, and a
publication whose title uses different words than the buyer's query is invisible
even when it is exactly what they needed.

The owner's lore already has a shape — the blueprint captures whether it is
organized chronologically, by theme, by project, or by knowledge area. None of
that structure reaches the buyer today, so a flat match list is the only view of
a library that is not actually flat.

## Proposed approach

Expose a **navigable tree of publication metadata**. The buyer walks the tree by
node, sees metadata at each level (topic label, child counts, kind, freshness),
descends into branches that look relevant, and selects the specific publications
they want to purchase — rather than issuing a keyword query and hoping.

Keyword search stays as a retrieval primitive; browsing is an additional entry
point, not a replacement.

**The first deliverable is a schema change, not an endpoint.** Publications
carry no grouping metadata today — no topic, no path, no axis — so there is
nothing to build a tree *from*. Before any browsing surface exists, publications
need an owner-approved grouping field, assigned at publish time as part of
XC-002's approval step (which is what makes every node label owner-approved
text rather than request-time synthesis — see below). The blueprint's organizing
axis (chronological / theme / project / knowledge) is the natural default for
that field's vocabulary, since it is already the owner's chosen structure.

**The privacy constraint is the hard part, and it is the whole design.** The tree
must be constructed *only* from active publications. A tree that mirrors the
private library's structure leaks the shape of private material even when no
private content is returned: branch labels reveal topics the owner never
published, child counts reveal how much exists, and gaps reveal what was
withheld. That is the same class of leak as the provenance memory ids removed in
STO-001 (PR #19) — metadata about private rows is itself a disclosure.

A branch label is also content. If tree nodes are derived by grouping
publications, the *label* on a node is a new externally-visible claim about the
owner that no one approved. Either labels come from owner-approved text, or
grouping is restricted to structure the owner already approved.

## Acceptance criteria

- [ ] A buyer can navigate publication metadata by node and select specific
      publications to purchase, without issuing a keyword query.
- [ ] Everything a buyer can observe by browsing — labels, counts, ordering,
      structure — is derived exclusively from owner-approved fields of active
      publications. A test walks the full tree and asserts it is byte-identical
      before and after private rows are added, edited, and discarded.
- [ ] Every externally-visible node label is owner-approved text, not text
      synthesized at request time from private material.
- [ ] Revoking a publication removes it from the tree immediately, and removes
      any node that existed only to hold it.

## Notes

From a design conversation between Shane and Dipak, 2026-07-29, resolving the
open question Dipak raised on PR #19 ("do we still want keyword search only post
tree discussion or more agentic search?"). Answer: browsing, not agentic search —
metadata is exposed to the searching party, who navigates it and chooses what to
buy. STO-001 keeps FTS5 over publications as the retrieval primitive; this item
is the additional surface.

Blocked by XC-002 twice over: there is nothing to browse until the publish flow
can create publications, and the grouping field this item's tree hangs on must be
assigned inside XC-002's approval step — so XC-002's design should reserve room
for it (one extra owner-visible field at approval, not a new decision).

Revised 2026-07-30 after self-review: the original fifth acceptance criterion
("browsing reveals nothing not discoverable via `discover`") was vacuous — every
active publication matches some query, so any tree satisfied it. Replaced with an
observability invariant: the tree must be byte-identical under any change to
private rows. Also made explicit that the first deliverable is the publications
grouping field, which the item previously only implied via the blueprint.

Open questions, none blocking the item's existence:

- **Pricing granularity.** Selecting individual items to purchase implies
  per-publication pricing; `lore price` is currently one fixed price per answer.
  Per-item pricing is likely a separate `MON` item.
- **Is browsing free?** `discover` is free and content-safe today. A tree is
  strictly more informative, so "free" needs re-deciding rather than assuming.
- **Depth and breadth limits**, to bound how much structure any one buyer can
  enumerate — related to the existing "protection against repeated queries that
  reconstruct private material" safeguard in the README.
- **Does selection produce one `answer` call per item, or a basket?**
- **Does the blueprint axis belong on the wire at all?** Telling a buyer the lore
  is organized chronologically is itself a small disclosure about the owner.
