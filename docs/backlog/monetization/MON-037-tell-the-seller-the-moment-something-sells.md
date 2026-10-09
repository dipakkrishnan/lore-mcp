---
id: MON-037
title: Tell the seller the moment something sells, and how often each page is read
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-035, XC-039, MON-029]
blockers: []
dependencies: []
github_issue: 366
created: 2026-10-04
updated: 2026-10-04
---

## Problem

The sales ledger was visible only on For Sale, so a seller found out about a
sale only by going to look. The first cent earned should be felt the moment
it happens, or sellers stop publishing and sharing. There was also no sign
of interest short of a sale.

## Proposed approach

- While Lore is open, the main process reads the ledger once a minute and
  whenever the window comes back to the front. Each new sale is a native Mac
  notification ("You sold a piece" / "<title> · $3.00 by card"), and more
  than three at once become one ("You sold 5 pieces" / "$2.50"). Clicking
  it opens For Sale. The newest sale already announced is kept in the app's
  own data folder, so a relaunch never repeats one, and a first read of an
  existing store never replays its history.
- Today shows what the store has earned and the latest three sales. Sales
  say plainly how each was paid (by card / by an agent) and link card sales
  to the seller's Stripe Dashboard.
- The node counts page views per piece (`page_views`: piece id and a count,
  nothing about who looked), on GET `/p/<id>` only. `lore node views --json`
  reads them, and For Sale shows them beside each piece.

## Acceptance criteria

- [x] A new sale posts one Mac notification; old sales never do; many at
      once are one notification.
- [x] Today shows total earned and recent sales, card sales labelled.
- [x] Views count GET page loads only, never HEAD, the JSON listing, the
      store page, or a buyer reopening their receipt; no visitor data kept.

## Notes

Pages are served with `cache-control: public, max-age=60` and Workers Cache
(MON-029), so a view served from the edge cache may not reach the Worker and
isn't counted, while crawlers and link-preview unfurlers are, so the number
can run low or high. Read it as a rough signal of interest, not an audience. Buyers' questions to the answer
tier are kept in `answer_jobs` but not shown in the app yet; that is a
follow-up.
