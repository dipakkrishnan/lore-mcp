---
id: MON-008
title: Stand up a standing Base Sepolia QA deployment of the Worker
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-002, MON-003, MON-005, MON-006, MON-010, MON-016, XC-008]
blockers: [MON-016]
dependencies: ["A protected GitHub Environment named qa holding CLOUDFLARE_API_TOKEN and QA_PAYOUT_ADDRESS — not repository secrets", "A Cloudflare account authorizing that token, and a Base Sepolia wallet funded from the CDP faucet for QA_PAYOUT_ADDRESS"]
github_issue: null
created: 2026-08-01
updated: 2026-08-26
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

- [x] `wrangler.jsonc` defines a `qa` environment with its own worker name and
      its own D1 database, and no tracked file needs hand-editing to deploy it
- [x] A merge to `main` redeploys QA automatically, and the deployed URL is
      recorded somewhere fixed rather than recovered from wrangler state
- [ ] QA's D1 contains seeded fixture publications after a deploy, and
      `npm run smoke -- <qa-url>` passes against it — verified locally
      (`wrangler dev --env qa`), not yet against a live deploy (see Notes)
- [ ] The QA recipient wallet and QA buyer wallet are distinct from each other
      and from any wallet used elsewhere, both on Base Sepolia only — needs an
      admin to mint and fund both; the workflow only wires whatever address
      is put in `QA_PAYOUT_ADDRESS`
- [x] The deploy credential is a scoped API token in a protected GitHub
      **Environment**, not a repository secret — the latter is readable by every
      workflow in the repo, including any future one
- [x] The deploy job is used by no pull-request job, cannot run on a fork, and
      never uses `pull_request_target`
- [x] Third-party actions in the deploy job are pinned to a full commit SHA
- [x] The node README says how to reach QA, what is in it, and that anything
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

**Prioritization pass 2026-08-03:** blocker `MON-002` is `completed`. Promoted
`in-review` → `ready` at `P1` — criteria are extensive but concrete, and
`XC-008` (the live testnet suite) is itself blocked on this landing, so it's
on the critical path for more than its own acceptance criteria.

**Implementation 2026-08-24:** everything expressible in code is done and PR'd:
`env.qa` in `wrangler.jsonc` (own worker name `lore-qa`, own D1 database
`lore-publications-qa`), `.github/workflows/deploy-qa.yml` (push-to-main only,
`environment: qa`, `actions/checkout`/`actions/setup-node` pinned to full
commit SHAs, `contents: read` by default with `contents: write` only on the
one job, guarded to this repository so it cannot run from a fork), the D1
database and its id resolved and committed back automatically on first run
(mirrors `lore/deploy.py`'s `_ensure_d1`, so no tracked file ever needs a
manual edit), `scripts/qa-fixtures.sql` seeding two synthetic publications,
and a README section covering how to reach QA, what it holds, and that it is
disposable. Verified locally end to end short of a real Cloudflare account:
`wrangler dev --env qa` plus the fixture SQL produces a `discover` manifest
with both fixture titles, and `npm run smoke` passes against it.

What is left is exactly the three things no workflow can provision for
itself, all listed in `dependencies` above: an admin creates the GitHub
Environment `qa` and populates `CLOUDFLARE_API_TOKEN` (scoped to Workers + D1)
and `QA_PAYOUT_ADDRESS` (a fresh Base Sepolia address, never used elsewhere)
as Environment secrets, and separately mints and funds a QA buyer wallet from
the CDP faucet for `XC-008`'s live suite to spend from. Once that's in place,
the first merge to `main` will provision the D1 database, deploy, seed
fixtures, smoke-check, and record the live URL at `lore/node/.qa/node-url.txt`
without further action — that first real run is what closes the two
unchecked criteria above and moves this to `completed`.

**2026-08-26:** merging this landed `Deploy QA` on `main` unconfigured, which
failed loudly on every subsequent merge — a broken-looking build for
something that was always going to need the setup step above. Fixed to warn
and skip cleanly instead (#161). The provisioning itself is split out to
`MON-016` so it is separately trackable and assignable.

**2026-08-26 (audit):** corrected `blockers` from `[MON-002]` (completed
back on `MON-002`'s own timeline, no longer a real blocker) to `[MON-016]`
— `MON-016`'s own Notes already say "`MON-008` stays `in-review` until this
closes," so the blocker relationship existed in practice; the frontmatter
had just never been updated to say so.
