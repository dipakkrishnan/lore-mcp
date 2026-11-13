---
id: MON-051
title: Let buyers bid for a piece nobody sells yet
priority: P0
effort: M
component: monetization
status: in-review
related: [XC-114, XC-115, XC-116, XC-117, MON-053, MON-054, MON-055, XC-093, XC-074, MON-046]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-31
updated: 2026-11-12
---

## Problem

Sellers don't know what's worth publishing, and visitors can't see demand. That's why "why would
someone buy this?" has no answer on the site. A first user's first suggestion was letting people
place offers. Agents are the natural bidders: when a search finds nothing that answers their
task, they have nowhere to say "I'd pay for this."

## Proposed approach

A **bid** is one record: a question, an amount, a market, and a way to reach the buyer. It has
one kind only. There's no pooling, no rising bids and no market-wide bids. See the proposal at
https://claude.ai/artifact/EHfg2NK8ZsggCKohHrXUUi (v2, Oct 31).

- **Record.** `bids` in the registry the relay already writes:
  `{id, question, usd_cents, market, contact (email or callback_url), status, created,
  expires, answers[]}`. Status is `open → answered → filled | expired`. Lore keeps this record
  of who offered what. It never holds money.
- **Placing.** `POST /bids` on the relay needs no account. It's rate-limited, and the owner can
  delete spam. The minimum is $5 so card fees don't eat a bid. A bid ends after 7 days.
- **Filling, with no new payment code.** A seller's answer becomes a piece in that market,
  priced at the bid amount. The buyer gets its link and buys it through the existing checkout
  (card or x402). Several sellers can answer one bid, and the buyer picks one or none. A bid
  is only a promise, so the record counts how often buyers walk away. If that number is bad,
  saving a card at bid time and charging it on accept, as a direct charge to the seller, is
  the next step. Lore still holds no money in that version.
- **Not blocking.** `POST /bids` returns an id and a status URL right away. Fast tasks buy
  existing pieces. Bids are for long-running work and work that can wait on a person.

## Acceptance criteria

- [x] A person or an agent places a bid with one form post or one `POST /bids`, with no account, and gets back an id and a status URL.
- [ ] A seller's answer to a bid becomes a listed piece at the bid amount in the bid's market.
- [ ] Buying that piece through the existing checkout moves the bid to `filled` (see MON-054). Nothing else can set `filled`.
- [x] An unanswered bid expires after 7 days, and no money ever moves through Lore.
- [x] Walked-away bids (answered, never bought) are counted.

## Notes

- Oct 31 build (PR for MON-051): the bid book lives on the site Worker, not the relay registry,
  per contracts/bids.md: `BidBook` SQLite Durable Object in `site/src/bids.js`, routes in
  `site/src/bid-routes.js`. Placing, the 7-day end, the walked-away count (`walked_away` in
  `/bids.json`) and buyer callbacks on each new answer are done. No route can set `filled`.
  Left open on purpose: answers become listed pieces through the owner by hand (MON-055) and
  later the app (APP-274); `filled` comes only from the rail (MON-054). This stays
  `in-progress` until those land.

- From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
- Oct 31: reshaped from an "Ask for a piece" form into bids, after the Oct 30–31 proposal. The
  card hold and EIP-3009 settlement ideas were dropped. EIP-3009 fixes the payee at signing,
  so it can't fund an open bid. $1 card holds are mostly fees and look like card testing to
  Stripe's fraud checks.
- Not in v1: pooled bids, rising bids, market-wide (collection-offer) bids, sealed bids for
  labs, USDC holds.

**Backlog audit (2026-11-12), moved to in-review:** Placing bids, expiry and
the walked-away count shipped in PR #623. MON-054 (#637) then changed the
fill model to card-on-bid with charge-on-accept, which is the step this item
called conditional, so criterion 3 no longer describes how a bid is filled.
Criterion 2 waits on MON-056. Back to in-review so the remaining criteria
can be rewritten around the accept flow, or the item closed with them handed
to MON-054 and MON-056.
