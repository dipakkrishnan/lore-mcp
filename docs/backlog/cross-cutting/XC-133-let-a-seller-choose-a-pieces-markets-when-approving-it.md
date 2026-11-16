---
id: XC-133
title: Let a seller choose a piece's markets when approving it, and propose a new one
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-074, XC-119, XC-036, MON-036]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

The marketplace lists pieces by market (XC-074), but a piece only gets into a
market when someone adds a `listings: [{market, piece}]` entry to
`marketplace.json` in dipakkrishnan/lore-marketplace by pull request. The
seller has no say from the app. The approval cards in
`app/desktop/src/renderer.js` (the "Approve what to sell" section, saved
through `lore publication decide` in `state.cjs`) offer price, Preview, Edit,
Skip and Approve, and no market. In the app, markets appear only for bids
(`Inbox.market` in `inbox.js`, `stageBidAnswer` in `state.cjs`). A seller with
a piece that fits no existing market has no way to ask for one.

## Proposed approach

- The approval card offers the registry's markets (read from the same
  `marketplace.json` the site reads) as a short pick list, with the model's
  best guess pre-chosen from the piece's topic. The choice is saved with the
  publication and carried in the store's free `discover` for that piece.
- The registry's daily refresh (XC-036) reads each listed store's `discover`
  and keeps `listings` from what the store declares, so no hand-made PR is
  needed for an existing market.
- "Suggest a new market" on the card opens the prefilled request form on
  lore-marketplace (as `lore marketplace list` already does for stores), with
  the piece named. Markets are still opened by curation, never automatically.
- An unlisted store's choice is kept and takes effect when it is listed.

## Acceptance criteria

- [ ] The approval card shows the registry's markets and saves the seller's
      choice with the piece; a piece can sit in more than one market.
- [ ] The store's `discover` carries each piece's chosen markets, and the next
      registry refresh lists the piece under them on /marketplace with no
      hand-made PR.
- [ ] "Suggest a new market" opens a prefilled request on lore-marketplace
      naming the piece; nothing else creates a market.
- [ ] `design-review` run; dark-mode screenshot of the approval card attached.

## Notes

Filed 2026-11-15 from the in-review close-out. Takes over XC-074's criterion 5
("Sellers choose markets for a piece when approving it in the app, and
propose new ones"), restated against today's approval cards. XC-074's
criterion 6 went to XC-134. XC-119 (classifying bids into markets) is the
bid-side counterpart and shares the proposed-market PR path.
