---
id: XC-017
title: Introduce paid proxy answers through the owner skills
priority: P2
effort: M
component: cross-cutting
status: completed
related: [MCP-003, XC-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-18
updated: 2026-08-20
---

## Problem

The paid `answer` tier has an owner CLI, but the owner skills never explain
when to enable it, how it differs from selling a publication with `get`, or
what the "proxy charter" means. An owner can finish onboarding, publish useful
material, and enable payments without ever discovering the feature; if they do
find the command, the charter can sound like a credential instead of public
instructions for an AI speaking as their proxy.

## Proposed approach

Add one optional handoff to the existing flow rather than a new onboarding
phase. Once the owner has an approved publication and chooses Monetize,
`lore-enable-payments` should offer the two products plainly: sell the source
with `get`, or sell a grounded proxy response with `answer`. If they choose
answers, draft short public proxy instructions from the already-confirmed
blueprint/profile, show the exact text and per-answer price, and hand approval
to the attended `lore answer on <file> <price>` command. Keep publishing-only,
free, and private-only paths complete in themselves.

Update the handoffs in `lore-onboard`, `lore-publish`, and
`lore-enable-payments`; use "public proxy instructions" in the skills even if
the CLI retains "charter" internally. Do not duplicate pricing, deployment, or
approval mechanics outside the payments skill.

## Acceptance criteria

- [x] A fresh owner can move from onboarding to publishing to Monetize and is
      offered paid proxy answers only after at least one publication is
      approved.
- [x] Before approval, the flow explains `get` versus `answer` and makes clear
      that proxy instructions are public behavior guidance, not an API key,
      secret, private blueprint, or claim that the owner is present.
- [x] The owner sees and explicitly approves the exact proxy instructions and
      per-answer price in an attended terminal; no skill silently enables the
      tier or approves on the owner's behalf.
- [x] Private-only, free, and publication-only paths remain valid end states.
- [x] The conversational dry-run for the three skill handoffs covers both
      accepting and declining the paid-answer offer.

## Notes

This is cross-cutting because it changes the onboarding, publishing, and
payments skills as one owner journey. `MCP-003` owns the buyer-facing answer
tool; this item owns how the seller understands and enables it.

The accepting dry-run follows onboarding → one approved publication → Monetize →
`get` plus optional `answer` → exact public instructions and price → attended
approval → push. The declining dry-run ends at private-only,
approved-but-unreachable, free, or publication-only without running
`lore answer on`.
