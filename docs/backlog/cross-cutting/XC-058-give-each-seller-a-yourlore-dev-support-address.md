---
id: XC-058
title: Give each seller a yourlore.dev support address
priority: P2
effort: M
component: cross-cutting
status: ready
related: [MON-030, XC-041, XC-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Every store page ends with the seller's support email (MON-030), and card
buyers' Stripe receipts show the support email from the seller's Stripe
public details. A seller who doesn't want their personal inbox public has to
set up their own forwarding address first. `support@yourlore.dev` is Lore's
own support, so sellers can't share it.

## Proposed approach

When a seller turns on cards, offer `<handle>@yourlore.dev` and create a
Cloudflare Email Routing rule that forwards it to an inbox they verify. The
rule lives on Lore's yourlore.dev zone; Lore never reads the mail. Set the
alias as their store's support email and suggest it for Stripe public
details. Removing the store or turning off cards removes the rule.

## Acceptance criteria

- [ ] A seller gets a yourlore.dev address that forwards to their verified
      inbox, without touching Cloudflare.
- [ ] Their store footer shows the alias, never the inbox behind it.
- [ ] Handles can't collide with Lore's own addresses (support@, etc.).

## Notes

Dipak's store uses `dipak@yourlore.dev`, set up by hand on 2026-10-06;
`support@yourlore.dev` is Lore's. Replies still come from the seller's real
inbox unless they set up "Send mail as".
