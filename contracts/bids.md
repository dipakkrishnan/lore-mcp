# Bids contract (MON-051)

A bid is a question with an amount someone will pay for an answer. Bids live
on the site Worker (`site/`, yourlore.dev), so a person, a browser agent, a
coding agent and later the MCP server (XC-117) all use the same records,
and the forms post back to the same origin. Lore keeps the record of who
offered what. It never holds money.

## Storage

One SQLite Durable Object, `BidBook` (binding `BIDS`), is the only writer.
`site/src/bids.js` owns it; nothing else writes bids.

```sql
CREATE TABLE bids (
  id TEXT PRIMARY KEY,          -- 10 chars, [a-z0-9], random
  question TEXT NOT NULL,       -- 10..280 chars, trimmed
  usd_cents INTEGER NOT NULL,   -- 500..100000
  market TEXT NOT NULL,         -- a registry market slug, or "unsorted"
  email TEXT,                   -- optional; never public
  callback_url TEXT,            -- optional https URL; never public
  created TEXT NOT NULL,        -- ISO 8601 UTC
  expires TEXT NOT NULL         -- created + 7 days
);
CREATE TABLE bid_events (       -- append-only; nothing is updated in place
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  bid_id TEXT NOT NULL,
  type TEXT NOT NULL,           -- opened | answered | filled | expired | removed
  at TEXT NOT NULL,
  data TEXT                     -- JSON: answered → {handle, piece_url, preview, usd_cents};
                                --       filled   → {rail: "card"|"x402", proof}
);
```

**Status** is computed from the events: `removed` wins, then `filled`, then
`expired` (when `now >= expires` and the bid isn't filled), then `answered`
(if any answer exists), else `open`.

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
  "created": "2026-10-31T22:10:00Z",
  "expires": "2026-11-07T22:10:00Z",
  "answers": [
    { "handle": "dipak", "piece_url": "https://…/p/…", "preview": "first lines…", "usd": 20, "at": "…" }
  ],
  "events": [{ "type": "opened", "at": "…" }]
}
```

## Routes (yourlore.dev)

| Route | What it does |
|---|---|
| `POST /bids` | Place a bid. Takes a form post (`question`, `usd`, `market`, `email`, `callback_url`) or the same fields as JSON. A form post gets a 303 to `/b/:id`. JSON gets a 201 with `{id, url, status_url, expires}`, where `status_url` is `/b/:id.json`. Needs no account. Rate-limited per client and globally. No IP is stored. `usd` is whole dollars, 5–1000. |
| `GET /bids` | The board (XC-114). |
| `GET /bids.json` | `{bids: [public shape…]}` for bids that are open or answered, newest first. |
| `GET /b/:id` | The bid's page (XC-115). |
| `GET /b/:id.json` | The bid's public shape. Unknown and removed ids get a 404. |
| `POST /b/:id/answers` | Add an answer: `{handle, piece_url, preview, usd}`. Needs `Authorization: Bearer $BIDS_ADMIN_TOKEN` in v1, because the owner adds answers by hand during the test (MON-055). The app path (APP-274) replaces this later. |
| `DELETE /b/:id` | Appends `removed` (spam). Needs the admin token. |

**No route sets `filled`.** Only the payment rail does that, through MON-054:
checkout's webhook over a service binding, or a Base lookup.

## Validation errors

Each error is a 400 with `{error: "<plain sentence>"}` for JSON, or the
form shown again with the message for a form post. Examples: "Write a
question of at least 10 characters." "Bids are $5 to $1,000."

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
