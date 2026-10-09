---
id: XC-045
title: Run card checkout on a restricted Stripe key
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-039]
blockers: []
dependencies: ["A sandbox restricted key Dipak creates in the Stripe dashboard (keys can't be created through the API)"]
github_issue: null
created: 2026-10-05
updated: 2026-10-05
---

## Problem

checkout.yourlore.dev runs on Lore's full live secret key. Anyone who gets
it can do anything on the platform account: refund, read balances, change
settings. Checkout needs only a few calls.

## Proposed approach

Give the Worker a restricted key (`rk_live_…`) that can only make these
calls, each on a seller's connected account:

| Call | Used by |
| --- | --- |
| `POST /v2/core/accounts` | `/accounts`: open a seller's account |
| `GET /v2/core/accounts/:id` (`configuration.merchant`, `requirements`) | `/accounts/status`, `/verify`, `/create`: ready, checking, bound store |
| `POST /v2/core/accounts/:id` (metadata only) | `/accounts/bind`: tie the account to its store |
| `POST /v2/core/account_links` | `/onboard`: Stripe's form |
| `POST /v1/checkout/sessions` with `Stripe-Account` | `/create`: the Buy button |
| `GET /v1/checkout/sessions/:id` with `Stripe-Account` | `/verify`, `/webhooks`: was it paid |

Webhook signature checks use `STRIPE_WEBHOOK_SECRET`, not the key.

Seller tokens are an HMAC keyed on their own `ACCOUNT_TOKEN_SECRET` Worker
secret (`signer()` in `checkout/src/index.ts`), not on `STRIPE_SECRET_KEY`,
so swapping or rolling the Stripe key no longer logs sellers out of
`/accounts/status`, `/accounts/bind` and `/onboard`. No seller had connected
when this changed, so there was nothing to migrate.

`GET /health` proves a key works after a swap: it lists one v2 account
(`GET /v2/core/accounts?limit=1`, a read the account permissions above
already cover) and answers only `{"ok":true}`, or `{"ok":false}` with a 502.

Steps:
1. In the sandbox, create a restricted key with the fewest permissions
   that plausibly cover the table, for example Checkout Sessions write and
   Connect account (v2) write; Stripe's errors name the exact permission
   when one is missing (`v2_account_storer_write` was seen in testing).
2. Point a local checkout Worker at it and run the sandbox path end to
   end: open an account, onboard with test values, status, bind, buy with
   the 4242 card, webhook. Add each permission an error names, and nothing
   else.
3. Record the final list here, create the same restricted key in live, set
   it with `wrangler secret put STRIPE_SECRET_KEY` from a terminal outside
   any agent session, check `curl https://checkout.yourlore.dev/health`
   answers `{"ok":true}`, then roll the full secret key in the dashboard.

## Acceptance criteria

- [ ] The permission list is recorded here, found by running the sandbox
      path against a restricted key.
- [x] Seller tokens no longer depend on the Stripe key, and a connected
      seller's app still reads its status after the swap.
- [ ] The live Worker runs on the restricted key, and the full secret key
      is rolled.

## Notes

Found 2026-10-05 while going live: the full key went in first so checkout
could launch. A platform can't read its own account through the v2
Accounts API even with the full key (`forbidden`), so test with connected
accounts only.
