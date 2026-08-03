---
id: MON-008
title: Stand up a standing Base Sepolia QA deployment of the Worker
priority: P2
effort: M
component: monetization
status: in-review
related: [MON-002, MON-003, MON-005, MON-006, MON-007, XC-008]
blockers: [MON-002]
dependencies: ["Cloudflare account with Workers and D1", "Base Sepolia wallet funded from the CDP faucet", "GitHub repository secrets for the deploy token"]
github_issue: null
created: 2026-08-01
updated: 2026-08-01
---

## Problem

There is nowhere to test the Worker against a real chain except a developer's
laptop and a hand-made deployment. `lore/node/wrangler.jsonc` defines exactly one
environment — `name: "lore-x402-canary"`, one D1 binding whose id is the literal
placeholder `REPLACE_WITH_YOUR_D1_ID`, and one `LORE_WALLET` secret — so
deploying at all today means hand-editing a tracked file, and two people
deploying means two divergent edits.

The consequence is that `MON-002`'s payment run proves something once and then
the evidence evaporates. Nothing stays standing. The next change to the paid
path is verified against the same nothing, and `MON-005`'s mainnet cutover would
be the first deployment anyone had exercised repeatedly — which is the one place
that must not be true.

There is also no separation between a QA target and whatever an owner deploys.
With a single worker name, a single D1 database, and a single wallet, a QA
deploy and a real node collide on all three.

## Proposed approach

Add a `qa` environment to `wrangler.jsonc` — its own worker name, its own D1
database, its own wallet — and deploy it from `main` automatically.

1. **Environment split.** A `[env.qa]` block with `name: "lore-x402-qa"` and a
   separate D1 binding. Replace the `REPLACE_WITH_YOUR_D1_ID` placeholder for
   the QA environment with the real id; leave the default environment's story
   alone, since that is what an owner deploys (`MON-006`).
2. **Seed data.** A fixture set of publications pushed into QA's D1 on deploy,
   so `discover` and `answer` have known rows to return and a live assertion can
   name an exact expected title. Fixtures only — never a real owner's library.
3. **Wallets.** A dedicated QA recipient address, and a dedicated QA buyer
   funded from the faucet, both used nowhere else. Neither is ever a mainnet
   wallet.
4. **Deploy on merge.** A workflow job that deploys `env.qa` on pushes to `main`
   using a Cloudflare API token scoped to Workers + D1 and nothing more. This is
   the first job in the repo to hold a credential; it must be separate from the
   pull-request jobs `XC-004` defines, which stay credential-free and must not
   run on forks.

Running tests against this environment is `XC-008`. This item is done when the
target exists, is reproducible, and is documented.

## Acceptance criteria

- [ ] `wrangler.jsonc` defines a `qa` environment with its own worker name and
      its own D1 database, and no tracked file needs hand-editing to deploy it
- [ ] A merge to `main` redeploys QA automatically, and the deployed URL is
      recorded somewhere fixed rather than recovered from wrangler state
- [ ] QA's D1 contains seeded fixture publications after a deploy, and
      `npm run smoke -- <qa-url>` passes against it
- [ ] The QA recipient wallet and QA buyer wallet are distinct from each other
      and from any wallet used elsewhere, both on Base Sepolia only
- [ ] The deploy credential is a scoped API token in repository secrets, is used
      by no pull-request job, and cannot run on a fork
- [ ] The node README says how to reach QA, what is in it, and that anything
      in it is disposable

## Notes

Blocked on `MON-002` on purpose: a permanently deployed payment endpoint should
not be the thing that discovers whether a payment can settle at all. `MON-002`
answers that once by hand; this makes the answer durable.

Deliberately Base Sepolia only. Nothing in this item's configuration should be
capable of pointing at mainnet — `MON-005` owns that transition and has to stay
the only way it can happen.

Overlaps with `MON-006` at the edges: that item moves *owner-facing* deploy
mechanics into the CLI, and notes the canary rename. This item is the
maintainers' own environment. If `MON-006` lands first, deploy QA with whatever
command it produces rather than duplicating wrangler invocations.
