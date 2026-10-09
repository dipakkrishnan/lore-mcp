---
id: MON-042
title: Settle keyless real-money stores through PayAI, not the test facilitator
priority: P1
effort: XS
component: monetization
status: ready
related: [MON-005, MON-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

A real-money store without CDP keys settles x402 payments through x402.org,
which only handles test networks. Since 738f7ca1,
`lore/node/wrangler.jsonc` sets
`LORE_FACILITATOR_URL=https://x402.org/facilitator` in the top-level `vars`,
and `facilitator()` in `lore/node/src/network.ts` uses that var ahead of
`KEYLESS_FACILITATOR` (PayAI). Agent payments to these stores would fail.
Dipak's store is fine because it has CDP keys set.

## Proposed approach

Remove `LORE_FACILITATOR_URL` from the default `vars` and keep it only in
`env.qa` and the tests, or have mainnet ignore an x402.org override. Also fix
the config comment that says the var is unset in deployment.

## Acceptance criteria

- [ ] A mainnet node with no CDP keys uses the PayAI facilitator
- [ ] A test asserts the deployed default config resolves to PayAI on mainnet
- [ ] Testnet and QA still use x402.org

## Notes

Filed from the 2026-10-06 new-seller audit.
