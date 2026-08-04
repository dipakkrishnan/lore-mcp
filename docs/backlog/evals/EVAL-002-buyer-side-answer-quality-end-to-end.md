---
id: EVAL-002
title: Evaluate answer quality from the buyer's side of the MCP surface
priority: P1
effort: M
component: evals
status: ready
related: [EVAL-001, MCP-001]
blockers: [XC-002, MON-003]
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-08-03
---

## Problem

EVAL-001 evaluates the owner's pipeline: does synthesis produce good memories
and safe answers from real Lore machinery. Nothing evaluates the transaction
the product actually sells: a buyer's agent, knowing nothing about the owner,
calls `discover` with its own vocabulary, decides whether to pay, calls
`answer`, and either got its money's worth or did not. The failure modes are
buyer-side and invisible to EVAL-001 — a relevant publication missed because
the buyer's words don't match the owner's (the FTS vocabulary gap MCP-001
names), a `discover` that says `can_help` when it can't (a paid empty answer),
or an answer whose content is right but useless to an agent that lacks the
owner's context. Once real money settles per answer, every one of these is a
buyer paying for nothing — the exact hole the payment work kept closing at the
protocol layer, still open at the content layer.

## Proposed approach

Extend EVAL-001's harness one hop outward: per case, stand up the real MCP
surface over a seeded publications set, drive it with a buyer agent that only
sees the public surface (no owner context, questions phrased in the buyer's
own words), and judge whether discover's verdict was honest and the answer was
worth the advertised price. Score discover honesty (would a buyer who paid
after this `can_help` feel cheated?) separately from answer quality. Post
MON-003, point the same harness at a deployed Worker so the edge path — D1
reads, revocation propagation — is what gets judged, not a local
approximation.

## Acceptance criteria

- [ ] An eval case fails when `discover` reports it can help and the
      subsequent `answer` returns nothing relevant to the query.
- [ ] Cases include buyer phrasings that deliberately do not reuse the
      owner's publication vocabulary.
- [ ] The harness drives the real MCP surface (and, once MON-003 lands, a
      deployed Worker), not a roleplay of it.

## Notes

From the PR #42 discussion: after the rail is proven, "buyer agent getting
good answers" is the last unverified link in the seller-first chain. Related
to MCP-001 (browsing is one proposed fix for the vocabulary gap this eval
would measure — this item provides the measurement either way).

**Prioritization pass 2026-08-03:** both blockers (`XC-002`, `MON-003`) are
`completed`. Promoted `in-review` → `ready` at `P1` — this is the last
unverified link in the seller-first chain per the note above, criteria are
concrete, and `MCP-003` (the paid proxy tier) lists this item as one of its
own blockers, so it's on the critical path for more than itself.
