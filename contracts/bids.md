# Bids contract (MON-051)

A bid is a question with an amount someone will pay for an answer. Bids live
on the site Worker (`site/`, yourlore.dev), so a person, a browser agent, a
coding agent and later the MCP server (XC-117) all use the same records,
and the forms post back to the same origin. Lore keeps the record of who
offered what. It never holds money.

A person's bid carries a card (MON-054). Stripe saves it to a customer on
Lore's platform account when the bid is placed, and nothing is charged. When
the buyer accepts an answer, or two days after the first answer if they don't
choose, checkout clones the card onto the answer's seller's connected account
and charges the bid amount there as the seller's own direct charge. An agent
may place a bid without a card; it is shown as "no card on file" and listed
below carded bids, so agent demand is counted without looking like money.

## Storage

One SQLite Durable Object, `BidBook` (binding `BIDS`), is the only writer.
`site/src/bids.js` owns it; nothing else writes bids.

```sql
CREATE TABLE bids (
  id TEXT PRIMARY KEY,          -- 10 chars, [a-z0-9], random
  question TEXT NOT NULL,       -- 10..280 chars, trimmed
  usd_cents INTEGER NOT NULL,   -- 500..100000
  market TEXT NOT NULL,         -- a registry market slug, or "unsorted"
  email TEXT,                   -- optional; never public; kept for MON-053, not yet used or asked for on the form
  callback_url TEXT,            -- optional https URL; never public
  created TEXT NOT NULL,        -- ISO 8601 UTC
  expires TEXT NOT NULL         -- created + 7 days
);
CREATE TABLE bid_events (       -- append-only; nothing is updated in place
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- opened | answered | accepted | declined | card_updated
                                -- | filled | expired | removed
  at TEXT NOT NULL,
  data TEXT                     -- JSON: opened   → {card};
                                --       answered → {handle, piece_url, preview, usd_cents};
                                --       accepted → {answer (index), auto};
                                --       declined → {answer, reason, message};
                                --       filled   → {rail: "card"|"x402", proof, payment_intent, answer}
);
CREATE TABLE buyers (           -- only for bids placed with a card; never public
  bid_id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,       -- SHA-256 of the buyer's 32-character key
  customer TEXT,                -- cus_… on Lore's platform, set when Stripe saves the card
  payment_method TEXT           -- pm_… on Lore's platform; replaced when the buyer updates the card
);
CREATE TABLE charges (          -- one row per accepted event whose charge checkout answered
  seq INTEGER PRIMARY KEY,      -- the accepted event's seq; the attempt id is bid-<id>-<seq>
  bid_id TEXT NOT NULL,
  payment_intent TEXT,          -- the pi_… Lore created, or null when it was declined at once
  account TEXT                  -- the seller's acct_… it was created on
);
```

**Status** is computed from the events: `removed` wins, then `filled`, then
`paying` (the latest `accepted` has no `declined` after it), then `expired`
(by event, or when `now >= expires` and nothing was ever accepted), then
`pending` (no `opened` yet: the card isn't saved), then `answered` (if any
answer exists), else `open`. When a bid's week runs out, the book appends its
`expired` event (at `expires`) the next time anything reads it, so the
timeline records the end without a timer.

**Card lifecycle.**

- *Placed.* A person's bid is `pending` and unlisted until checkout's webhook
  says Stripe saved the card; then `opened {card: true}`. When checkout can't
  make a setup page, the bid is deleted whole, so it holds no slot in the hour's cap. An agent's bid
  without a card opens at once with `{card: false}`.
- *Accepted.* The buyer accepts one answer (accepting the answer already being
  paid again is a no-op, so concurrent clicks make one `accepted` event), or the book accepts the first
  answer at `min(first answer + 2 days, expires)`. A carded bid with an answer
  is therefore accepted before its week ends, and an accepted bid ends through
  its payment, not the clock. The Durable Object's alarm sends each accepted
  charge to checkout once, with the attempt id `bid-<id>-<seq>` as Stripe's
  idempotency key; when Stripe can't be reached it tries again a minute later.
- *Declined.* A declined card or a bank asking to confirm appends `declined`
  with a plain `message`, whether checkout's reply says so or Stripe reports
  `payment_intent.payment_failed` or `.canceled` later for that same charge. The bid is `answered` again, and only the buyer sees
  why and an "Update your card" button. A new card appends `card_updated` and
  accepts the same answer again. A decline nobody fixes ends the bid at
  `max(decline + 2 days, expires)`, counted as walked away.
- *Filled.* Only `BidBook.paid`, reached only through the site's `BidRail`
  service entrypoint, which only checkout's Stripe webhook calls, after
  `payment_intent.succeeded` on the seller's account tied to the answer's store.
  It fills only for the exact PaymentIntent recorded for the latest accepted
  answer, on the seller account it was created on, in `usd`, for exactly the
  bid amount. A retry for the same charge answers `filled` again and appends
  nothing; a report that arrives before the charge's reply was recorded answers
  `pending`, and checkout returns 503 so Stripe sends it again. Only on
  `filled` is the seller's store told. `proof` is the Stripe charge id; the PaymentIntent
  stays private and opens the piece for the buyer.

## Public shape

`email` and `callback_url` never appear in any response.

```json
{
  "id": "k3v9q2m7xa",
  "url": "https://yourlore.dev/b/k3v9q2m7xa",
  "question": "How do you stop reward hacking on long coding tasks?",
  "usd": 20,
  "market": "rl-evals",
  "status": "open",
  "card": true,
  "created": "2026-10-31T22:10:00Z",
  "expires": "2026-11-07T22:10:00Z",
  "answers": [
    { "handle": "dipak", "piece_url": "https://…/p/…", "preview": "first lines…", "usd": 20, "at": "…" }
  ],
  "events": [{ "type": "opened", "at": "…" }]
}
```

Each event is `{type, at}`. An `answered` event also carries `handle`, an
`accepted` event `answer` and `auto`, and a `filled` event `rail` and `proof`,
so the timeline can say who answered and link the proof (XC-115). A decline's
reason is never public; the timeline says only "Payment didn't go through".

**The buyer's key.** A carded bid has a 32-character key, shown once: the form
sets it as an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `/b/:id`, and a
JSON post gets it back as `key` and `manage_url` (`/b/:id?key=…`, which sets the
cookie). With the key (cookie or `Authorization: Bearer`), `/b/:id.json` adds
`receipt_url` (the answer's piece, `?session_id=pi_…`, once filled) and
`payment_problem`, and `/b/:id` shows the accept and card buttons.

## Routes (yourlore.dev)

| Route | What it does |
|---|---|
| `POST /bids` | Place a bid. Takes a form post (`question`, `usd`, `market`, `email`, `callback_url`) or the same fields as JSON. A form post always saves a card: it gets a 303 to Stripe's setup page, which returns to `/b/:id`, and the key cookie. JSON gets a 201 with `{id, url, status_url, expires, card}`, where `status_url` is `/b/:id.json`; with `"card": true` it also gets `card_url` (Stripe's setup page, for the agent's person), `key` and `manage_url`. When checkout can't make a setup page, a 502 says so plainly. Needs no account. Rate-limited per client and globally (a 429 with a plain sentence), and `BidBook` refuses more than 100 new bids an hour, because the rate-limit bindings count per Cloudflare location. No IP is stored. `usd` is whole dollars, 5–1000. |
| `GET /bids` | The board (XC-114). |
| `GET /bids/stats.json` | What the board polls: `{bids, offered, markets, tape, tape_key, board, board_key}`, the counts plus the ticker and columns as HTML, each with a key that moves only on real news. |
| `GET /bids.json` | `{bids: [public shape…], walked_away}` for bids that are open or answered (a bid whose charge is out isn't listed), carded first, newest first. `walked_away` counts bids that were answered and then ended unfilled (MON-051). |
| `GET /b/:id` | The bid's page (XC-115). |
| `GET /b/:id.json` | The bid's public shape. Unknown and removed ids get a 404. |
| `POST /b/:id/accept` | The buyer accepts an answer: `answer` (its index) as a form post with the key cookie, or JSON with `Authorization: Bearer <key>`. A form gets a 303 to `/b/:id`; JSON a 202 with the public shape. 403 without the key; 409 with no card, an unknown answer, or a bid not `answered`. |
| `POST /b/:id/card` | The buyer saves a card on a `pending` bid, or a new one after a decline: a 303 (JSON: `{card_url}`) to Stripe's setup page, reusing their customer. |
| `POST /b/:id/answers` | Add an answer: `{handle, piece_url, preview, usd}`. Needs `Authorization: Bearer $BIDS_ADMIN_TOKEN` in v1, because the owner adds answers by hand during the test (MON-055). The app path (APP-274) replaces this later. |
| `DELETE /b/:id` | Appends `removed` (spam). Needs the admin token. |

**Callbacks.** When an answer is added to a bid that has a `callback_url`,
the site POSTs the bid's public shape (JSON) there, once per new answer,
after replying to the answer route. One attempt with a 5-second timeout and
no redirects; a failure is logged and nothing else. Only `https` addresses
outside `yourlore.dev` and its subdomains are accepted, so a callback can't
loop back into the site.

**No route sets `filled`.** Only the payment rail does that (MON-054):
checkout's Stripe webhook, over the `BIDS_RAIL` service binding to the site's
`BidRail` entrypoint. A Base lookup for x402 is not built yet.

## Service bindings

| From → to | Methods |
|---|---|
| site `CHECKOUT` → checkout `BidCards` | `setup({bid, question, customer, return_url}) → {url}` (null when Stripe can't); `charge({bid, attempt, customer, payment_method, piece_url, usd_cents, question}) → {ok: true, payment_intent} \| {ok: false, retry: true} \| {ok: false, reason, message}` |
| checkout `BIDS_RAIL` → site `BidRail` | `cardSaved(bid, {customer, payment_method})`, after `checkout.session.completed` (setup mode) on the platform; `paid(bid, {payment_intent, charge, amount_cents, currency, account}) → "filled" \| "pending" \| "rejected"`, after `payment_intent.succeeded`; `failed(bid, {payment_intent, account, message}) → "declined" \| "pending" \| "rejected"`, after `payment_intent.payment_failed` or `.canceled` |

**Webhook secrets.** The platform endpoint's secret is accepted only for
setup-mode `checkout.session.completed` on Lore's own account; the Connect
endpoint's secret only for events on sellers' accounts. Neither authorizes the
other's events.

`charge` reads the payee from the answer's store (`/p/<id>.json`) and refuses
unless that account is tied to that store, exactly as a piece checkout does.

## Validation errors

Each error is a 400 with `{error: "<plain sentence>"}` for JSON, or the
form shown again with the message for a form post. Examples: "Write a
question of at least 10 characters." "Bids are $5 to $1,000." "The
callback address can't be on yourlore.dev."

## Matching on the seller's Mac (APP-274)

The desktop app reads `GET /bids.json` (or `LORE_BIDS_URL`) at launch and then
every 15 minutes, give or take 20%, never on focus. That request shows the
site this Mac's IP address and that it runs Lore, nothing else: no memory,
match or dismissal. The app reads at most 1 MB and 200 bids, and drops a bid
whose question is over 280 characters. `lore bids match` takes those bids on
stdin (with the same caps, and at most 16 words searched per question) and
prints the bids the owner's kept memories answer:

```json
[{"bid": {"id": "…", "question": "…", "usd": 40, "market": "…", "url": "…", "expires": "…"},
  "memories": [{"id": 12, "title": "…"}], "score": 0.83}]
```

The score is the share of the question's meaningful words a memory holds,
each weighted by how rare it is in the library (search is the library's own
SQLite full-text index). A bid matches at 0.5 or more; the corpus in
`tests/fixtures/bids` puts every answerable bid at 0.62+ and every other bid,
near misses included, at 0.31 or less. Only bids that are `open` or
`answered` and inside their week match. The app keeps the matches in its own
data folder with the bids the owner dismissed. Every change to that file
goes through one queue. A match counts as announced only after its
notification is up.

A stranger wrote the question, so the answer is drafted in one model call
with **no tools**. The app reads the matched memories itself and sends their
title and text, with the question as JSON data. The model returns only
`{title, teaser, content, useful_if, not_useful_if}`. The app then stages the
draft with `provenance` set to the matched ids and `"bid": "<id>"`, beside the
drafts already waiting and replacing an earlier answer to the same bid. An
approved piece keeps that `bid` on its row. Until the owner sends it, nothing
about it leaves the Mac.

## Sending a seller's answer (MON-056, designed, not built)

`POST /b/:id/answers` stays admin-only until this lands. The seller's path
needs no new secret, because the answer is a piece already on the seller's
own registered store, and only the seller can put a piece there:

1. The app posts `{piece_url}` with no token, after the owner approves the
   piece and it is pushed to their store.
2. The site finds the registry seller whose `store` address starts
   `piece_url`; the answer's handle is that seller's registry name. A URL no
   registered store owns is a 400.
3. The site reads that store's free catalog the way the marketplace does
   (`discover` over MCP, `site/src/markets.js`). The piece must be listed
   there with `bid` equal to this bid's id; otherwise 403 "That piece isn't
   an answer to this bid." That `bid` field is what proves the seller meant
   it: the store's manifest carries the bid id the owner approved the piece
   for.
4. `preview` is the piece's teaser and sample from that catalog, and `usd`
   the store's price; anything else in the body is ignored.
5. One answer per bid and piece (a repeat is a 200 with the bid as it is),
   rate-limited like placing a bid, and the bid must still be live.

It needs the manifest to carry `bid` (the Python export and the store
Worker's `discover`), and the store listed in the registry, so it is its own
item.
