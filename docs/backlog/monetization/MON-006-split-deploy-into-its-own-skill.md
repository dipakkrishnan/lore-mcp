---
id: MON-006
title: Split node deployment out of lore-enable-payments into its own skill
priority: P2
effort: S
component: monetization
status: in-review
related: [MON-002, MON-005, XC-005]
blockers: [MON-003]
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

The `lore-enable-payments` skill (PR #42) contains the Worker deploy steps
(wrangler login, `LORE_WALLET`, deploy, smoke) inside a skill named for
payments. That grouping is deliberate today: the Worker serves only canary
content, so the sole reason to deploy is to prove the payment rail, and
splitting would force a skill hand-off mid-flow for no benefit. It becomes the
wrong shape the moment MON-003 lands: deploying then has a payment-independent
purpose (a free node serving publications is a first-class outcome), the deploy
half grows D1 setup and `lore push`, and a free-node owner's front door should
not be a skill named enable-payments. "Deploy my lore node" currently triggers
a payments skill.

## Proposed approach

When MON-003 lands, extract the deploy steps into a dedicated deploy skill:
wrangler login / secret / deploy / smoke, plus the D1 push MON-003 introduces.
Move the "deploy my lore node" trigger to it. `lore-enable-payments` keeps the
decision layer (path choice, wallet, price, test buy, mainnet gate) and routes
to the deploy skill at its boundary — the skill-to-skill routing test added in
PR #42 guards that reference the moment the new skill folder exists, and
correctly fails on it before then (which is why the new skill must land in the
same change as the references to it). The mainnet cutover steps (MON-005) are
deploy-side and belong to the new skill.

## Acceptance criteria

- [ ] A deploy skill exists that takes an owner from nothing to a live Worker
      (and, post-MON-003, pushed publications) without mentioning price,
      wallets, or payment — and a free node is a complete outcome of it.
- [ ] `lore-enable-payments` contains no wrangler commands; it routes to the
      deploy skill by name, and the routing contract test passes.
- [ ] The "deploy my lore node" trigger lives in the deploy skill's
      description, not in `lore-enable-payments`.

## Notes

Deferred by design in PR #42 — see the discussion there. The skill's own text
notes the pending split. Also fold in at split time: the follow-up to name
`lore-publish` in the routing (deferred from PR #42 until XC-002 / PR #38
merges).
