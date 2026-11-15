---
id: MON-054
title: Mark a bid filled only from the payment rail, as a shared record
priority: P2
effort: S
component: monetization
status: in-review
related: [MON-051, MON-046, XC-115]
blockers: []
dependencies: [MON-051]
github_issue: null
created: 2026-10-31
updated: 2026-11-12
---

## Problem

Sellers asked for receipts that both buyer and seller can look at to see that a sale settled.
MON-046 designs a signed public log, but it is XL. Bids need a settlement record from day one
that nobody can fake, Lore included.

## Proposed approach

Follow MON-046's rule from the start: the payment rail is the truth.

- `filled` is set only by checkout's Stripe Connect webhook (card) or by a Base lookup that
  shows a USDC transfer of at least the bid amount to that store's registered `payTo` (x402).
  There is no manual path.
- Bid events are append-only (`opened`, `answered`, `filled`, `expired`, `refunded`). Nothing
  is edited in place.
- The bid page (XC-115) is the shared record. USDC fills link the Base transaction. Card fills
  say "confirmed by Stripe," and the buyer also gets Stripe's emailed receipt. The page states
  that signed public receipts come with MON-046.
- The events use MON-046's record shapes, so the receipts Worker can sign them later without
  a migration.

Nov 2 (approved Oct 31): a bid is cheap talk without money behind it, so a person's bid
saves a card when it's placed and is charged when the buyer accepts an answer (or two days
after the first answer), as a direct charge on the answering seller's connected account. The
card is saved on Lore's platform with a setup-mode Checkout Session and cloned onto the
seller's account at charge time, so Lore still holds no money.

## Acceptance criteria

- [x] A person's bid saves a card through Stripe before it opens; the bid is `opened` only from checkout's setup webhook.
- [x] An agent's bid without a card is allowed, labeled "no card on file", and listed below carded bids.
- [x] Accepting an answer (or 2 days after the first answer) charges the bid amount once, as a direct charge on the seller's account tied to the answer's store.
- [x] A card charge moves its bid to `filled` exactly once, only from checkout's Stripe webhook over the `BidRail` service binding; retried webhooks add nothing.
- [x] A declined card leaves the bid answered, tells the buyer plainly, and a new card retries the same answer.
- [ ] An x402 report whose transaction doesn't pay the store the bid amount leaves the bid unfilled. (Base lookup not built.)
- [x] No route, token or admin action sets `filled`.
- [ ] A refund or dispute appends `refunded` and edits nothing. (Not built: `charge.refunded` and `charge.dispute.created` on the Connect endpoint are next.)

## Notes

- Nov 2 build (PR "MON-054: save the buyer's card when a bid is placed and charge it, direct
  to the seller, on accept"): `checkout/src/bids.ts` (`BidCards` entrypoint: setup, charge),
  `checkout/src/webhooks.ts` (setup and `payment_intent.succeeded` events), `site/src/bid-rail.js`
  (`BidRail` entrypoint), `site/src/bids.js` (cards, accept, alarm). See contracts/bids.md.
- Buying an answer's piece through its ordinary piece checkout doesn't fill the bid; only the
  bid's own charge does.
- Deploy needs a platform webhook endpoint (`checkout.session.completed`) and its secret
  `STRIPE_PLATFORM_WEBHOOK_SECRET`, `payment_intent.succeeded`, `.payment_failed` and `.canceled` added to the Connect endpoint,
  and both Workers deployed (they bind to each other's entrypoints).
- Open risks: cloning a platform PaymentMethod onto a connected account needs Stripe's
  sign-off for the platform; an off-session charge can still ask for bank confirmation (SCA),
  which v1 treats as a decline the buyer fixes by saving the card again.

**Prioritization (2026-11-12):** Priority P2 (was P1). Stays in-review.
Before it can be ready: Split the two open criteria into their own items, or
close with them handed off: checking x402 fills against Base belongs with
MON-046's rail check; reversing a fill needs a charge.refunded and
charge.dispute.created handler, which nothing has. Prioritization flag (not
acted on): done (card path, #637).
