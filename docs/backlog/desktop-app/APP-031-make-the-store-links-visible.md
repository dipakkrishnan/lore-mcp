---
id: APP-031
title: Make the store's outbound links visible
priority: P2
effort: XS
component: desktop-app
status: in-review
related: [APP-009, XC-020, APP-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

The Store bar's "Cloudflare ↗" link renders as small muted text beside
the node address and is easy to miss (Dipak, 2026-08-23: "the Cloudflare
thing is hard to see. Maybe highlight it?").

## Proposed approach

Promote outbound store links to visible affordances: a small secondary
button or accent chip ("Open in Cloudflare ↗") on the Store bar, same
treatment for the payout-address link when XC-020 lands. Keep the address
itself selectable text.

## Acceptance criteria

- [ ] The Cloudflare console link reads as a control, not body text.
- [ ] Consistent treatment ready for the XC-020 payout link.
