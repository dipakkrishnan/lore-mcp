---
id: MON-016
title: Provision the qa GitHub Environment's credentials so Deploy QA can actually run
priority: P1
effort: S
component: monetization
status: ready
related: [MON-008, XC-008]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-26
updated: 2026-08-26
---

## Problem

`MON-008` shipped `.github/workflows/deploy-qa.yml`, which deploys the
standing QA node on every merge to `main` — but only an admin holding the
real Cloudflare account and repository admin access can create the
credentials it authenticates with; nothing an agent runs can provision
these for itself. Until this item is done, the workflow warns and skips
itself cleanly (see the follow-up fix merged right after `MON-008`) rather
than failing, but the QA node itself does not exist yet: no deploy has ever
actually run, `lore/node/.qa/node-url.txt` still says "Not yet deployed",
and `XC-008` (the live testnet suite) has nothing to test against.

## Proposed approach

One-time, by hand, as the repository owner:

1. **GitHub Environment.** Settings → Environments → New environment, named
   exactly `qa` (the workflow references this name). Optionally add required
   reviewers if deploys should need manual approval; not required for this
   item to close.
2. **Cloudflare API token.** Mint a token at the Cloudflare dashboard scoped
   to *Workers Scripts: Edit* and *D1: Edit* for the account that will host
   QA — nothing broader. Add it to the `qa` Environment as a secret named
   `CLOUDFLARE_API_TOKEN`.
3. **QA payout address.** Generate or set aside a fresh EVM address that
   will never be used for anything else — not an owner's real payout
   wallet, not the QA buyer wallet in the next step. Add its `0x...` address
   to the `qa` Environment as a secret named `QA_PAYOUT_ADDRESS`. No private
   key is needed; this is a public receiving address.
4. **QA buyer wallet.** Separately (not a GitHub secret — this is for local
   use against the deployed QA node, per `XC-008`), mint a dedicated Base
   Sepolia buyer key and fund it from the CDP faucet. Keep it distinct from
   the payout address above and from anything used elsewhere.
5. **Trigger the first deploy** — push any commit to `main` (or re-run the
   `Deploy QA` workflow manually). It provisions the D1 database, deploys,
   seeds fixtures, smoke-checks, and commits the live URL to
   `lore/node/.qa/node-url.txt` automatically from there.

## Acceptance criteria

- [ ] The `qa` GitHub Environment exists with `CLOUDFLARE_API_TOKEN` and
      `QA_PAYOUT_ADDRESS` set as Environment secrets, not repository secrets
- [ ] A `Deploy QA` run has completed successfully (not skipped) on `main`
- [ ] `lore/node/.qa/node-url.txt` holds a real `https://...workers.dev/mcp`
      URL, committed automatically by the workflow
- [ ] A dedicated, funded Base Sepolia QA buyer wallet exists, distinct from
      `QA_PAYOUT_ADDRESS` and from any wallet used elsewhere
- [ ] `MON-008`'s two remaining unchecked acceptance criteria are re-verified
      against the live deploy and checked off there

## Notes

Split out from `MON-008` (2026-08-26): everything expressible in code for
that item shipped and merged (#160), but closing its last two acceptance
criteria needs exactly the credentials this item provisions, which is
inherently a by-hand, off-repository action rather than something
`implementation` can do. `MON-008` stays `in-review` until this closes.
