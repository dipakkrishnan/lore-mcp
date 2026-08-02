---
id: MCP-001
title: Give discover an owner-approved manifest of the node's offerings
priority: P2
effort: L
component: mcp-server
status: in-progress
related: [STO-001, XC-002, MCP-002, MCP-003]
blockers: [XC-002]
dependencies: []
github_issue: null
created: 2026-07-29
updated: 2026-08-02
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

**Manifest first, tree only at scale.** The first shape is a single
owner-approved catalog — an AGENTS.md for the node — that `discover` returns so
the buying agent reads once and chooses: topics, publication titles, kind,
freshness, count, price. One round trip, and it plays to what agents already do
well (consume a manifest and pick), instead of asking them to walk an
interactive tree node by node. A realistic library (dozens to a few hundred
active publications) fits comfortably in one manifest; the navigable tree this
item originally proposed becomes the scale-up for when a manifest outgrows a
response, not the starting point.

**The manifest replaces buyer-side keyword search** (decided 2026-08-02,
Dipak — supersedes the earlier "additional entry point, not a replacement").
The 2026-08-01 simulation showed server-side matching failing in both
directions: the edge `LIKE` could not match natural language at all, and
FTS5 had no stemming and no relevance threshold, so one overlapping token
advertised a paid answer for the wrong thing. Relevance judgment moves to
the buying agent reading the manifest; the paid product becomes `get {id}` —
one publication, chosen from the catalog. `answer` is retired from the
surface and its name reserved for the MCP-003 proxy tier. Owner-side memory
search is untouched.

**Two leak budgets, not one.** The privacy constraint below protects the
*private* library's shape. The manifest also must not give away the *published*
value it exists to sell — and for `claim`-kind publications the title often IS
the claim ("Live demos outperform cold decks for agent-tool launches" delivers
its full value as a manifest line; nobody pays for that answer). Resolved
(2026-08-02): the manifest line is an owner-approved **teaser** distinct from
the title — required at publish approval, drafted question-shaped, shown on the
approval card so approving the publication approves the advertisement. The
divide is a column boundary: the manifest may select only
`public_id, teaser, topic, kind, updated_at` (day precision); title, content,
and provenance are paid-surface fields. Buyer-facing ids are opaque random
tokens minted at publish time — sequential ids would leak withdrawals as
visible gaps, the same leak class as the provenance ids removed in STO-001.

**The first deliverable is a schema change, not an endpoint.** Publications
carry no grouping metadata today — no topic, no path, no axis — so there is
nothing to build a tree *from*. Before any browsing surface exists, publications
need an owner-approved grouping field, assigned at publish time as part of
XC-002's approval step (which is what makes every node label owner-approved
text rather than request-time synthesis — see below). The blueprint's organizing
axis (chronological / theme / project / knowledge) is the natural default for
that field's vocabulary, since it is already the owner's chosen structure.

**The privacy constraint is the hard part, and it is the whole design.** The
manifest — and any later tree — must be constructed *only* from active
publications. A view that mirrors the
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

- [ ] A buyer's agent can read the manifest and select specific publications
      to purchase, without issuing a keyword query.
- [ ] Everything a buyer can observe in the manifest (or any later tree) —
      labels, counts, ordering, structure — is derived exclusively from
      owner-approved fields of active publications. A test renders the full
      manifest and asserts it is byte-identical
      before and after private rows are added, edited, and discarded.
- [ ] Every externally-visible node label is owner-approved text, not text
      synthesized at request time from private material.
- [ ] Revoking a publication removes it from the manifest immediately, and
      removes any grouping that existed only to hold it.

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

Revised 2026-07-31: reframed manifest-first (Dipak) — discover should return an
AGENTS.md-style catalog the buying agent reads and chooses from in one round
trip; the navigable tree becomes the scale-up when a manifest outgrows a
response. All privacy constraints unchanged and apply to the manifest verbatim.
The schema prerequisite is unchanged too: the owner-approved topic field at
XC-002 approval time is what the manifest groups by.

Revised 2026-08-02 (Dipak, implementation in PR #57): manifest replaces
buyer-side search rather than supplementing it, `answer` retired for `get`,
teaser chosen as the leak-budget resolution, opaque public ids adopted — see
the amended approach above. Two of the open questions resolved by the shape:
selection produces one `get` per item (no basket), and browsing is free
because the manifest is the advertisement. Pricing granularity and
depth/breadth limits remain open. Known ceiling carried in code: at the paid
edge, payment settles before the lookup, so a revocation racing a recent
discover bills one not-found; opaque ids make any other billable miss
unreachable in practice.
