---
id: APP-019
title: Set the global publication price in Desktop
priority: P1
effort: M
component: desktop-app
status: in-progress
related: [MON-009, MON-013, APP-006, APP-035, XC-020]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-09-03
---

## Problem

The only way to set what a buyer pays for a publication is the CLI:
`lore price <usd>`. Desktop shows the configured global price but cannot change
it, so an owner who approves their first publication cannot finish opening a
store without leaving the app. The live Worker also bakes this price in at
deploy time; saving a new local value does not change what buyers pay.

## Proposed approach

Add one inline editor to the For Sale summary. A fixed, typed main-process
action saves one positive global USD price through Lore's existing validation
and refreshes the snapshot; do not route approval through agent Bash or an
environment marker. Other views keep displaying the same value rather than
growing duplicate editors.

Offer **Set a price** after the first publication approval and before opening a
store. Confirm the exact per-call amount before saving. If a node is already
live, say that it keeps charging the old price and offer the existing deploy
task; only a successful `lore node deploy` proves the new price is live.

This item does not add per-publication overrides, bundles, answer pricing, or
automatic pricing. `MON-009` owns evidence for finer publication pricing;
`APP-035` owns the optional answer tier.

## Acceptance criteria

- [x] One positive global publication price can be reviewed and saved from For
      Sale without the CLI; invalid values show Lore's validation reason inline.
- [x] After a save, every Desktop surface that shows publication price agrees.
- [x] First approval with no price set leads the owner to set one.
- [x] Pricing is not silently applied by the agent: the owner confirms the
      exact amount through the typed Desktop action.
- [x] Changing the price of a live node offers redeploy, never claims `push`
      changed it, and `discover` shows the new amount after redeploy.
- [ ] The flow is walked end to end on a real node before the item closes.

## Notes

The CLI accepts zero as a local "free" setting, but `lore node deploy` rejects
it because there is no paid store to deploy. Desktop's For Sale flow therefore
asks for a positive price; choosing not to sell remains a separate valid path.

Per-publication pricing does not block this global editor. Answer price belongs
with the charter and enable/disable decision in `APP-035`, not in a generic
Prices setting.

Implemented 2026-09-03. Shape: a `pricing:set` IPC handler runs `lore price` the
way `publication:revoke` and `store:push` already do; For Sale owns the one
editor and Today and Settings send the owner there. `discover` already
advertised `price_usd` and `snapshot.Manifest` was discarding it, so the
snapshot now carries `node.live.price_usd` — the redeploy prompt names what the
node actually charges instead of guessing, and falls back to "its old price"
when the node is unreachable. `lore node deploy` needed no cache change: every
successful deploy ends in a remote `push`, which already calls `forget_live()`.

The deploy skill's price step moved onto the same card: a `propose_price` tool
lets the agent suggest an amount that only the owner's confirmation saves, and
the tool returns what they chose. Honest limit — the desktop agent has no
command-level Bash denial, so `lore price` is still *reachable* from agent Bash;
this is a convention boundary of the same strength as the
`LORE_ATTENDED_SURFACE` marker behind `publication:decide`. Making it unforgeable
is `APP-008`/`APP-035` work, not this item's.

Left `in-progress`: every criterion but the last was walked in the running app
over Electron's debug port against a scratch `LORE_HOME` (save, refusal of `0`,
negatives and text, sub-cent display, all three surfaces agreeing, both redeploy
wordings, the Today rung). The live-node walk needs a deployed Sepolia node and a
real `lore node deploy`, and has not been done.
