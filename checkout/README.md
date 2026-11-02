# Lore card checkout

Lore's card checkout (XC-039). A person on a piece page (`/p/<id>`) presses
**Buy for $N**. Their browser posts the store's origin and the piece id here,
and this Worker opens a Stripe Checkout Session as a direct charge on the
seller's own connected account. The money lands in the seller's Stripe
account. It never passes through this Worker or Lore's balance.

- `POST /create`: reads the price, the payee and the piece's teaser from the
  store's free `/p/<id>.json`, never from the form, then redirects (303) to
  Stripe. Stripe sends the buyer back to `/p/<id>?session_id=…`.
- `GET /verify?session=cs_…&account=acct_…`: the store asks whether that
  session was paid, and for which store and piece. The store opens the piece
  only when the session paid for that piece in that store.

- Bids (MON-054, [contracts/bids.md](../contracts/bids.md)): yourlore.dev calls
  the `BidCards` entrypoint over a service binding. `setup` opens a setup-mode
  Checkout Session that saves the buyer's card to a customer on Lore's platform
  account, charging nothing. `charge` runs when the buyer accepts an answer: it
  clones that card onto the answer's seller's connected account and confirms an
  off-session PaymentIntent there for the bid amount, so it is the seller's own
  direct charge. What Stripe confirms comes back through the webhook and goes to
  the site's `BidRail` entrypoint (binding `BIDS_RAIL`), the only way a bid is
  filled. `/verify` also takes a bid's `pi_…`, so the buyer's receipt link opens
  the piece in the seller's store like a Checkout Session does.

The store takes cards only when the owner has connected an account
(`lore cards account acct_…`) and the store price is at least $0.50. That one
price applies everywhere (MON-028).

## Develop

```sh
npm ci
echo "STRIPE_SECRET_KEY=sk_test_…" > .dev.vars   # a Stripe test key; never a live one
echo "STRIPE_WEBHOOK_SECRET=whsec_…" >> .dev.vars
echo "STRIPE_PLATFORM_WEBHOOK_SECRET=whsec_…" >> .dev.vars
echo "ACCOUNT_TOKEN_SECRET=$(openssl rand -hex 32)" >> .dev.vars
npm test        # stubbed Stripe; no network
npm run dev
```

## Deploy

Runs at `checkout.yourlore.dev`, the default `CHECKOUT_URL` in
`lore/node/wrangler.jsonc`, on Lore's own Cloudflare account. Secrets are set
once, never committed, and never pasted into a chat:

```sh
npx wrangler secret put STRIPE_SECRET_KEY       # Lore's live secret key
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # signing secret of the live Connect webhook
npx wrangler secret put STRIPE_PLATFORM_WEBHOOK_SECRET   # signing secret of the live platform webhook (bids)
npx wrangler secret put ACCOUNT_TOKEN_SECRET    # `openssl rand -hex 32`; signs seller tokens
npx wrangler deploy
```

Seller tokens are signed with `ACCOUNT_TOKEN_SECRET`, not the Stripe key, so
the Stripe key can be swapped or rolled without logging sellers out. Changing
`ACCOUNT_TOKEN_SECRET` does log them out. After any key change,
`curl https://checkout.yourlore.dev/health` answers `{"ok":true}` when Stripe
takes the key and `{"ok":false}` (502) when it doesn't.

Two live webhook endpoints point at `https://checkout.yourlore.dev/webhooks`:

- a **Connect** endpoint, signed with `STRIPE_WEBHOOK_SECRET`, subscribed to
  `checkout.session.completed` and `checkout.session.async_payment_succeeded`
  (piece sales), and `payment_intent.succeeded`, `payment_intent.payment_failed`
  and `payment_intent.canceled` (a bid's direct charge settling or failing on
  the seller's account; without the last two a late failure leaves the bid
  "paying");
- a **platform** ("Your account") endpoint for `checkout.session.completed`
  (a bid buyer's card saved), signed with `STRIPE_PLATFORM_WEBHOOK_SECRET`.

The `BIDS_RAIL` binding names the site Worker's `BidRail` entrypoint, and the
site's `CHECKOUT` binding names this Worker's `BidCards`, so deploy both after a
change to either. A call fails, and is retried, until the other side is live.
