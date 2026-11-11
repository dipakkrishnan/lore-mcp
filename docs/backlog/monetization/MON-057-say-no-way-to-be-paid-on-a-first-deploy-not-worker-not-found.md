---
id: MON-057
title: Say "no way to be paid" on a first deploy, not "Worker not found"
priority: P3
effort: S
component: monetization
status: in-review
related: [MON-047, XC-069, XC-085, MON-024]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-11
updated: 2026-11-11
---

## Problem

`_deploy` (lore/deploy.py:1111-1125) checks for a payout before it creates anything. With no
`--wallet` and no card payments, it runs `wrangler secret list` with `fail=`. On an account where the
`lore` Worker has never been deployed, wrangler doesn't answer with an empty list. It exits non-zero
with `Worker "lore" not found. If this is a new Worker, run wrangler deploy first …`
(`wrangler-dist/cli.js` ~305563, checked on wrangler 4.147). `_detail` keeps that first `✘ [ERROR]` line,
and `StoreFailed.of` classes it `other`. The owner reads "reading your store's settings from Cloudflare
failed: Worker "lore" not found." The refusal written for this case never shows: "your store has no way to
be paid yet; turn on card payments (lore cards connect) or rerun with --wallet …", reason `no_payout`.
MON-047 promises that refusal ("names both ways out"). The same happens to a store whose Worker was
deleted on Cloudflare.

Only a terminal `lore node deploy` reaches this. The desktop always passes `--wallet` or sells by card
(app/desktop/src/state.cjs:368-372, 410-428). An inbox-only first deploy creates the Worker, so a later
full deploy hears the right refusal.

## Proposed approach

Read wrangler's not-found answer to `secret list` as "no LORE_WALLET", matching its words (`not found` and
`wrangler deploy` first), not the exit code, so the existing no_payout refusal follows. Every other listing
failure still stops the deploy (XC-069's rule). Don't skip the check when the Worker or `node_url` is
missing. That would let a store with no wallet and no cards deploy and open for sale.

## Acceptance criteria

- [ ] The fake wrangler in `tests/test_deploy.py` answers `secret list` with wrangler's not-found error until
      a `deploy` has run (today it answers `[]`, tests/test_deploy.py:140-144).
- [ ] With that fake, `lore node deploy` with no wallet and no cards raises `StoreFailed` with reason
      `no_payout` and the "no way to be paid" sentence, and runs neither `d1 create` nor `deploy`.
- [ ] A listing refused for another reason (auth 10000) still stops with the settings-read error
      (existing test around tests/test_deploy.py:1151-1159 still passes).
- [ ] A first deploy with `--wallet`, or with card payments on, is unchanged.

## Notes

Found 2026-11-11 by the lore-worker while reading `lore/deploy.py` after TEST-deploy (#697). Reproduced by
reading wrangler 4.147's `secret list` handler; the repo pins 4.151.1 (lore/node/package.json), so confirm the
wording there when implementing.
