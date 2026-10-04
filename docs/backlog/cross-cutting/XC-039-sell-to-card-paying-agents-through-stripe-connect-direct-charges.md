---
id: XC-039
title: Sell to card-paying agents through Stripe Connect direct charges
priority: P1
effort: L
component: cross-cutting
status: in-progress
related: [MON-009, MON-025, MON-026, MON-027, MON-028, MON-035, APP-019, XC-031, XC-034]
blockers: []
dependencies: ["Stripe preapproval for Lore as a content-creation platform"]
github_issue: null
created: 2026-09-29
updated: 2026-10-04
---

## Problem

Consumer personal agents pay with cards, not crypto. Instinct browses the
web and pays at an ordinary checkout with a Stripe Link one-time virtual
card, and Muse pays through Link inside its connectors. A Lore store only
takes USDC over x402 through MCP. So an agent like Instinct can read a
piece's page at `/p/<id>` (#341) but cannot buy it, and a seller has no way
to be paid into their bank. The wallet setup on both sides is also where the
first trial user stalled (MON-025).

## Proposed approach

Stripe Connect, model 1 (the Substack shape). Each sale is a direct charge on
the seller's own Stripe account, so seller money never passes through Lore.

- **Seller accounts.** Full Stripe dashboard. Stripe collects its fees from
  the seller and carries losses on the seller's account (`fees_collector:
  stripe`, `losses_collector: stripe`). Stripe does not allow these to change
  once an account exists, and this configuration accepts an application fee
  later, so choose it now.
- **Onboarding.** The desktop app gets a "Get paid to your bank" step that
  opens a Stripe Account Link in the system browser, since hosted onboarding
  doesn't run inside the app window. The connected account id is stored on
  the seller's store as configuration. Neither `deploy.py` nor the seller
  ever handles a Stripe key.
- **Lore checkout endpoint.** The platform key can't go on sellers' Workers,
  so a Lore-hosted Worker (next to the feedback relay) creates each Checkout
  Session with the `Stripe-Account` header. It sets
  `application_fee_amount`, which is 0 at launch, and returns the Checkout
  URL. It checks that the piece is listed in that seller's `discover` before
  charging. It never receives funds.
- **Store.** The piece page `/p/<id>` gets a **Buy for $N** button that goes
  to the checkout endpoint. On return (`?session_id=`) the store asks the
  endpoint whether the session was paid, for this piece, and for this seller,
  then serves the text with `cache-control: private, no-store`. The
  unauthenticated page stays `public, max-age=60`. A paid session writes a
  `sales` row with network `stripe` and the payment intent as `tx`.
- **Price.** Cards can't charge under $0.50, and fees are 2.9% + 30¢. Card
  checkout needs a store-wide card price saved in the store's settings,
  alongside the $0.01 x402 price, which stays for crypto agents. APP-019 is
  where the owner sets it. Packs are MON-009 and can come later.
- **Webhooks.** A Connect endpoint on the same Lore Worker records sales
  when the buyer never returns (`checkout.session.completed`) and tracks
  onboarding state (`account.updated`) for the desktop app.

Fallback if Stripe denies preapproval: sellers paste their own restricted
key (Checkout Sessions write) into their Worker, and the store creates the
session itself. Only where the key lives changes.

## Acceptance criteria

- [ ] In test mode, a seller goes from "Get paid to your bank" to a connected
      account without seeing a Stripe key, and the desktop app shows the
      account as ready.
- [ ] A browser opening a piece page on a test store completes Stripe
      Checkout with a test card, returns to the same URL, and reads the text.
      The sale shows in the seller's Stripe dashboard and in Lore's Sales
      list, and nothing lands in the platform balance.
- [ ] One purchase by Instinct, or another browsing agent, with a Link card
      succeeds end to end. Record whether Radar or bot checks interfered.
- [x] Unlocked responses carry `private, no-store`. A reused, foreign or
      unpaid `session_id` serves no text. Tests pin both.
- [ ] Setting a nonzero `application_fee_amount` in test mode moves only the
      fee to the platform balance. This proves a cut can be switched on later
      without a seller migration.
- [x] The x402 `get` path is unchanged, and the paid-path tests still pass.

## Notes

**Slice 1 (2026-10-04), built against a stubbed Stripe:**
- `checkout/` is the Lore-hosted Worker. `POST /create` reads the price,
  payee and teaser from the store's free `/p/<id>.json`, never from the form,
  and redirects to Stripe. `GET /verify` says whether a session paid, and for
  which store and piece.
- The store shows **Buy for $N** first when `stripe_account` is set and the
  price is at least $0.50 (MON-028). On `/p/<id>?session_id=…` it shows the
  full piece as `private, no-store` and writes one `stripe` sale per payment
  intent.
- `lore cards account acct_… | off` sets the account. The price floor is
  enforced in both directions.
- The application fee is omitted while it is 0, because Stripe requires a
  positive `application_fee_amount`.
- "Reused" in the criteria below reads as "used for another piece or store".
  A session id is the buyer's receipt for one piece, so reopening it works.
- Verified 2026-10-04 against Lore's Stripe sandbox: a headless browser paid
  $3 with the 4242 test card on a local store, returned to `/p/<id>`, and read
  the text (`private, no-store`). One `stripe` sale was recorded across three
  opens, the seller's balance rose by $2.61 after Stripe's fee, the platform
  balance did not move, and a forged session id showed nothing. The second
  criterion stays open until the sale also shows in the desktop Sales list.
- Slice 2a (2026-10-04): Settings → Your store → Card payments. "Get paid to
  your bank" has the checkout Worker open the seller's own account (Accounts
  v2: full dashboard, `fees_collector` and `losses_collector` both `stripe`)
  and sends them to Stripe's form in the browser. The app checks with Stripe
  when the owner comes back and offers "Turn on card payments" once
  `card_payments` is active and the price is at least $0.50. The Worker signs
  each account id with an HMAC token only the opening app holds, so an id
  read off a store page can't reopen that seller's form. Verified against
  the sandbox up to Stripe's form; the form itself is the owner's to fill.
- Still open: the Connect webhooks (`checkout.session.completed`,
  `account.updated`), the nonzero-fee check, a rate limit on opening
  accounts, and deploying `checkout/` to `checkout.yourlore.dev`.

Decided 2026-09-29: model 1 over having the platform charge and pay sellers
out (Uber, DoorDash) or being the seller of record (Gumroad, Paddle). The
rule reads "Lore never holds sellers' money", and a future fee is Lore's own
revenue.

- **Stripe preapproval.** Stripe lists content-creation platforms as
  restricted, preapproval required
  (https://stripe.com/legal/restricted-businesses). This is the slowest step,
  so apply first. Unverified: whether a sole proprietor can register as a
  platform.
- **Pricing.** No per-account or payout fees apply to Lore in this
  configuration (https://stripe.com/connect/pricing). A $3 sale nets the
  seller about $2.61. Application fees are not refunded automatically.
- **Sales tax.** Marketplace-facilitator rules on digital goods may reach
  Lore once it takes a cut. Get a legal answer before turning on a nonzero
  fee.
- **Muse.** A connector can later send buyers to the same checkout endpoint.
  Unverified: whether shared payment tokens work with direct charges on
  connected accounts. That is MON-026 cut 3's territory.
- **Out of scope.** One checkout across several sellers, and prepaid Lore
  credits. Both need model 2 and a separate decision.
