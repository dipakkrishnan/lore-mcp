---
id: APP-098
title: Read the real-money gates from the sales ledger in Desktop
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-057, MON-018, XC-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

"Switch to real payments" on a live store sent the desktop agent down three
minutes of plumbing: it tried to drive `npm run pay` (the sandbox cannot bind
tsx's socket), then Basescan and Etherscan (no key), then raw `eth_getLogs`
(range-limited), narrating CDP, RPC, USDC, tsx and the sandbox to the owner
before finally asking whether a test purchase had ever landed (final pass
2026-09-07). The skill's gate 2 said "a settled test-network payment" but not
where the app can read that from.

## Proposed approach

The node already records every settled sale (MON-018). Point the skill's
mainnet gate at `lore node sales --json`, and tell the desktop branch to read
the gates from state only, quietly, never running the buyer script or
querying the chain from the app. A sale from another machine stays one
question to the owner.

## Acceptance criteria

- [x] The skill names `lore node sales --json` as the proof of gate 2.
- [x] The desktop branch forbids driving a payment or reading the chain, and
      asks for one sentence on the gates in the owner's words.
- [ ] A live "Switch to real payments" on a store with a settled test sale
      reaches the CDP key step without narrating plumbing.
