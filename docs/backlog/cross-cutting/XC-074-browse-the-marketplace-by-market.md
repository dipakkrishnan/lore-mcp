---
id: XC-074
title: Browse the marketplace by market, with sellers' pieces listed underneath
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [XC-040, MON-036, APP-119]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-25
updated: 2026-10-25
---

## Problem

Nobody arrives at yourlore.dev/marketplace wanting a particular seller. They
arrive with a question. The page was a list of stores, one card per seller,
with topic chips copied from each store's private working labels ("Harness
false-equivalence"). It didn't show what you can learn there, and the labels
meant nothing to strangers.

## Proposed approach

Run it like an exchange. Lore lists **markets**: the question areas buyers
come for, each under a tab. Sellers list pieces into them, and each market
shows every seller's pieces underneath.

- **Registry (lore-marketplace#7):** a top-level `markets: [{id, name, tab}]`
  and, for each seller, `listings: [{market, piece}]`. Markets and listings
  are added by pull request. The daily refresh keeps a listing while the
  store still sells the piece. Ten seed markets hold all 24 live pieces.
- **Page (`site/src/worker.js`, `site/src/markets.js`):**
  - Tabs, search and a seller filter.
  - Live counts that roll in.
  - A "Latest" strip of real dates.
  - One card per market, with question, seller and price rows linking to
    each piece's own page.
  - A page per market showing the free samples.
  - Stores as a second level.
  - Pieces come from each store's free `discover`, cached for five minutes.
  - Everything works as plain links and forms for browsing agents.

Only real data: no empty markets, no invented activity, and piece dates
labelled "Updated".

## Acceptance criteria

- [x] Registry carries `markets` and `listings`, validated live against each store
- [x] /marketplace draws markets by tab, with search and a seller filter that work without a script
- [x] /marketplace/<id> shows every listed piece with its sample and a way to buy
- [x] Counts follow real changes live; the Latest strip shows only real dates
- [ ] Sellers choose markets for a piece when approving it in the app, and propose new ones
- [ ] Agent answers listed in a market, beside pieces

## Notes

Out of scope here: a purchases feed (it needs an opt-in public route on the
store), market creation without curation (it needs a stake and a reward for
the creator), and Lore's fee.
