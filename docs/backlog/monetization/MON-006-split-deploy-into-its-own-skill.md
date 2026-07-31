---
id: MON-006
title: Grow lore-deploy-node into the full edge-serving deploy flow
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

The deploy/payments skill split already happened: PR #42 ships `lore-deploy-node`
(Cloudflare account, `LORE_WALLET`, deploy, smoke) separate from
`lore-enable-payments` (path choice, wallet, price, test buy, mainnet gate), with
the routing between them contract-tested. What remains is that the deploy skill
deploys a canary: it has no step for getting the owner's publications to the
edge, because that machinery (D1 push and Worker reads — MON-003) does not exist
yet. When it lands, a deploy that skips the push step ships a node that answers
from sample content while looking fully deployed.

## Proposed approach

When MON-003 lands, extend `lore-deploy-node` with the publication push (and
re-push on publish/revoke), and remove the canary-content honesty note from both
skills once it stops being true. Mainnet cutover mechanics (MON-005) are
deploy-side and land in this skill when that gate opens. Also fold in at that
point: naming `lore-publish` in the enable-payments routing (deferred from PR #42
until XC-002 / PR #38 merges — the routing contract test guards it the moment
the folder ships).

## Acceptance criteria

- [ ] `lore-deploy-node` takes an owner from nothing to a live node serving
      their active publications, and revocation reaches the deployed node.
- [ ] Neither skill still claims the node serves canary content.
- [ ] `lore-enable-payments` routes to `lore-publish` by name and the routing
      contract test passes.

## Notes

Originally filed as "split deploy out of lore-enable-payments once MON-003
lands"; the split was pulled forward into PR #42 itself, so this item now
tracks only the post-MON-003 growth of the deploy skill.
