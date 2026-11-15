---
id: APP-098
title: Read the real-money gates from the sales ledger in Desktop
priority: P3
effort: XS
component: desktop-app
status: completed
related: [APP-057, MON-018, XC-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-11-13
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
- [ ] ~~A live "Switch to real payments" on a store with a settled test sale
      reaches the CDP key step without narrating plumbing.~~ No longer
      applicable: since MON-025 (#339) stores open on real money, so the switch
      only appears on a legacy store opened on the test network; any live
      paid-path walk belongs to APP-005.

## Notes

**Review 2026-10-19:** not completed. Skill side shipped (886d427, 5c0a96e). Unmet: a live Switch-to-real-payments run on a store with a settled test sale reaching the CDP key step.

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Close it, or fold the walk into APP-005 if legacy
testnet stores still matter. Prioritization flag (not acted on): obsolete
(mostly).

**Close-out (2026-11-13):** completed. Criteria 1-2 are on main:
`plugins/lore/skills/lore-enable-payments/SKILL.md:360` names
`lore node sales --json` as gate 2's proof, and the desktop branch rule
shipped in 886d427 / 5c0a96e. The live criterion is struck: 5c0a96e (MON-025,
#339) opens new stores on real money, and `app/desktop/src/renderer.js`
(~4754, "Stores open on real money; only one opened before that sits on the
test network") shows "Switch to real payments" only when
`storeStatus(s).test`. The edge seller walk still checks the switch is offered
(`app/desktop/support/edge.cjs:702`). A live walk of a legacy test store, if
anyone still has one, belongs in APP-005's paid-path proof.
