---
id: CAP-003
title: Seed a new owner's library from their public posts
priority: P1
effort: M
component: capture
status: in-review
related: [ONB-004, STO-002, CAP-001, APP-116, ONB-007]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-14
updated: 2026-09-14
---

## Problem

A trial owner with no Claude Code or Codex history (Zane, 2026-09-14) opens
Lore to an empty library and cannot tell what a first sellable asset should
be. His words: "it's hard for a user for me to think about what I should
first create"; the fix he asked for is "read my tweets or connect Substack +
LinkedIn ... and create my initial lores", which "shows me what good looks
like" and stops him duplicating work he already did in public. The people
most likely to build supply early are exactly the ones who already post.
Today capture takes dictation, pastes, files, and folders, and setup reads
only agent history, so a prolific writer starts from zero.

## Proposed approach

One capture rail, "seed from what you already wrote", fed by whichever
sources are reachable without cost or credentials:

- **Substack:** the owner gives their publication URL. Every publication has
  a public `/feed` with the full text of free posts, so no API or login is
  needed. Paid-only posts stay out.
- **Archive drop:** the owner drags in the zip that LinkedIn and X mail them
  on request. The capture skill already inventories folders; teach it the two
  archive layouts.
- **Signed-in window reads** for LinkedIn and X are `APP-116`; this item
  consumes what they return.

Posts land as private memories through the existing correction flow, one per
post or per cluster, with `source` naming the platform and `source_path` the
post URL. The blueprint's persona and topic outline steer clustering. Nothing
is listed for sale: public posts are already in every model, so they seed
evidence for bounded claims rather than becoming publications themselves. End
the run by proposing one or two topics worth publishing, the same nudge the
synthesis INDEX gives.

## Acceptance criteria

- [ ] An owner with no agent history and a Substack URL reaches Memories
      with their posts kept as private memories, each linking to its post.
- [ ] A dropped LinkedIn or X archive imports the owner's own posts and skips
      reposts, likes, and messages.
- [ ] The run ends with a "worth publishing" proposal drawn from the imported
      posts, not with an empty For Sale.
- [ ] Nothing imported is published or pushed without the usual approval.

## Notes

Connector facts checked 2026-09-14: Substack has no post API (its Developer
API returns profile fields behind a manual form) but `/feed` is public and
full-text for free posts. X's hosted MCP (api.x.com/mcp) is read-only and
bills the app owner per read with no free tier since Feb 2026; Dipak does
not want Lore to front that cost. LinkedIn's `r_member_social` is closed to
new applicants and the DMA portability API is EU-only, so LinkedIn is
archive or browser only. The buyer thesis's "not in the model" test is why
imports seed rather than sell.

2026-09-14, later: connectors are opt-in, agreed by Dipak and Zane. `ONB-007`
may find the owner's Substack or X handle from a public search and raise it
as a card ("do you want to connect your Substack"); this item never connects
a source the owner did not say yes to.
