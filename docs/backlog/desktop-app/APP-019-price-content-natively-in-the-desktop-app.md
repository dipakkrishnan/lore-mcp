---
id: APP-019
title: Price content natively in the desktop app
priority: P1
effort: M
component: desktop-app
status: ready
related: [MON-009, MON-013, APP-006, XC-020]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-26
---

## Problem

The only way to set what a buyer pays is the CLI: `lore price <usd>` for the
global per-publication price and `lore answer on - <usd>` / `lore answer
off` for the paid answer tier. The desktop app shows those numbers in four
places (Today's strip, the Store bar, the Store and Settings rows) and lets
the owner change none of them. An owner who approves their first
publication in the app has no way to decide what it costs without leaving
the app, and the pricing story itself — one global price, an optional
answer tier, per-publication overrides still undecided in MON-009 — has
never been walked as a product flow.

## Proposed approach

Treat pricing as an owner action routed through the existing attended
gates, like revoke and push: an inline editor on the Store bar (and the
Settings "Prices" row) that writes through `lore price` and `lore answer
on/off` with `LORE_ATTENDED_SURFACE=desktop`, validates in Python, and
refreshes the snapshot. Show the consequence before committing: what a
buyer's agent will be charged per call, whether the node is live (a price
change reaches buyers only after a push — reuse the push offer from APP-006),
and the payout address from XC-020. Offer pricing at the moment it matters:
after the first approval, and when the store goes live. Decide in MON-009
whether a per-publication override ships here or later; if it does, it
belongs on each For-sale row with the global price as its default.

## Acceptance criteria

- [ ] Publication price and answer price (with on/off) can be set from
      Store and Settings without the CLI; invalid values are rejected by
      Lore's validation with the reason shown inline.
- [ ] After a change, every surface that shows a price agrees, and a live
      node gets the push offer.
- [ ] First approval with no price set leads the owner to set one.
- [ ] Pricing is not silently applied by the agent; it is an owner action
      with a confirm step.
- [ ] The flow is walked end to end on a real node before the item closes.

## Notes

Filed from Dipak's request on 2026-08-23 ("build a way to price content
natively in the desktop app; that flow has not been super explored").
Per-publication pricing depends on the MON-009 decision; do not block the
global editor on it.

**Prioritization pass 2026-08-26:** No blockers; per-publication pricing is explicitly deferred to `MON-009` without blocking the global editor. Concrete enough to hand to implementation. Promoted `in-review` → `ready`.
