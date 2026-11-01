---
id: XC-114
title: Show live bids on a trading-screen board at /bids
priority: P0
effort: M
component: cross-cutting
status: ready
related: [MON-051, XC-115, XC-119, XC-093, XC-074]
blockers: []
dependencies: [MON-051]
github_issue: null
created: 2026-10-31
updated: 2026-10-31
---

## Problem

The site describes Lore in the abstract and never shows demand. A list of bids that never
moves reads as a dead forum. A board that looks like a live market makes "someone will pay for
this right now" obvious at a glance, for people and for browser agents alike.

## Proposed approach

A Kalshi-style board at `yourlore.dev/bids`, built from the marketplace's existing look:

- A **ticker** of new bids and fills ("New bid · $10 · RL evals", "Filled · $20 · @handle"),
  on the same poll the Latest strip already uses (`/marketplace/stats.json`).
- **Columns per market** with bids sorted by amount: question, amount, age, number of
  answers. Each market header shows the top bid next to the lowest asking price.
- A **"Place a bid"** sheet that is a plain HTML form posting to `POST /bids`, so browser agents
  (Instinct, Muse) and people use the same path.
- The home page (XC-093) shows the top three live bids as its real example of what Lore sells.

## Acceptance criteria

- [ ] `/bids` lists open bids grouped by market, sorted by amount, with a live ticker that updates without a reload.
- [ ] Placing a bid from the page's form (no JavaScript required) adds it to the board within one poll.
- [ ] The page reads correctly to a browser agent: every bid is a link with its question as the text and its amount next to it.
- [ ] The home page shows the top three open bids.

## Notes

Oct 31 product call: a live trading screen first, with question-and-answers depth on each bid's
own page (XC-115). Not posting bids on X.
