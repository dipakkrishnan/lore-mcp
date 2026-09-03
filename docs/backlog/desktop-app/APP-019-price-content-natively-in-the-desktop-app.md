---
id: APP-019
title: Set the global publication price in Desktop
priority: P1
effort: M
component: desktop-app
status: ready
related: [MON-009, MON-013, APP-006, APP-035, XC-020]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-28
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

- [ ] One positive global publication price can be reviewed and saved from For
      Sale without the CLI; invalid values show Lore's validation reason inline.
- [ ] After a save, every Desktop surface that shows publication price agrees.
- [ ] First approval with no price set leads the owner to set one.
- [ ] Pricing is not silently applied by the agent: the owner confirms the
      exact amount through the typed Desktop action.
- [ ] Changing the price of a live node offers redeploy, never claims `push`
      changed it, and `discover` shows the new amount after redeploy.
- [ ] The flow is walked end to end on a real node before the item closes.

## Notes

The CLI accepts zero as a local "free" setting, but `lore node deploy` rejects
it because there is no paid store to deploy. Desktop's For Sale flow therefore
asks for a positive price; choosing not to sell remains a separate valid path.

Per-publication pricing does not block this global editor. Answer price belongs
with the charter and enable/disable decision in `APP-035`, not in a generic
Prices setting.
