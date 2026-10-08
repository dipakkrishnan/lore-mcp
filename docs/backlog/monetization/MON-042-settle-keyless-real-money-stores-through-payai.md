---
id: MON-042
title: Settle keyless real-money stores through PayAI, not the test facilitator
priority: P1
effort: XS
component: monetization
status: completed
related: [MON-005, MON-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-08
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

- [x] A mainnet node with no CDP keys uses the PayAI facilitator
- [x] A test asserts the deployed default config resolves to PayAI on mainnet
- [x] Testnet and QA still use x402.org

## Notes

Filed from the 2026-10-06 new-seller audit.

**Implemented 2026-10-08.** Took the first approach: `LORE_FACILITATOR_URL` is
gone from the default `vars` in `lore/node/wrangler.jsonc` and stays in
`env.qa` and in the tests' own binding (`vitest.config.ts`). `network.ts` is
unchanged in behaviour — it already picked PayAI on mainnet once nothing
overrode it. `test/network.test.ts` now reads the shipped `wrangler.jsonc`
itself, so the config and the code are tested together: the older unit tests
built their env by hand, which is how this stayed green.

The alternative (mainnet ignoring an x402.org override) was left out on
purpose. `lore node deploy` copies the config and the source together and runs
a plain `wrangler deploy`, which replaces the Worker's plain vars, so there is
no leftover-var case for it to catch, and with it in place the config test
could no longer tell a fixed config from a broken one. An owner who sets
`LORE_FACILITATOR_URL` by hand still overrides the facilitator on any network.

A keyless real-money store that is already deployed keeps the old var until
its owner runs `lore node deploy` again. A hand `npx wrangler deploy` from an
existing `~/.lore/node` is not enough: that folder still holds the old config
until `lore node deploy` restages it.
