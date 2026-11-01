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
  email TEXT,                   -- optional; never public; kept for MON-053, not yet used or asked for on the form
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
(if any answer exists), else `open`. When a bid's week runs out, the book
appends its `expired` event (at `expires`) the next time anything reads it,
so the timeline records the end without a timer.

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

Each event is `{type, at}`. An `answered` event also carries `handle`, and a
`filled` event carries `rail` and `proof`, so the timeline can say who
answered and link the proof (XC-115).

## Routes (yourlore.dev)

| Route | What it does |
|---|---|
| `POST /bids` | Place a bid. Takes a form post (`question`, `usd`, `market`, `email`, `callback_url`) or the same fields as JSON. A form post gets a 303 to `/b/:id`. JSON gets a 201 with `{id, url, status_url, expires}`, where `status_url` is `/b/:id.json`. Needs no account. Rate-limited per client and globally (a 429 with a plain sentence), and `BidBook` refuses more than 100 new bids an hour, because the rate-limit bindings count per Cloudflare location. No IP is stored. `usd` is whole dollars, 5–1000. |
| `GET /bids` | The board (XC-114). |
| `GET /bids/stats.json` | What the board polls: `{bids, offered, markets, tape, tape_key, board, board_key}`, the counts plus the ticker and columns as HTML, each with a key that moves only on real news. |
| `GET /bids.json` | `{bids: [public shape…], walked_away}` for bids that are open or answered, newest first. `walked_away` counts bids that were answered and then ended unfilled (MON-051). |
| `GET /b/:id` | The bid's page (XC-115). |
| `GET /b/:id.json` | The bid's public shape. Unknown and removed ids get a 404. |
| `POST /b/:id/answers` | Add an answer: `{handle, piece_url, preview, usd}`. Needs `Authorization: Bearer $BIDS_ADMIN_TOKEN` in v1, because the owner adds answers by hand during the test (MON-055). The app path (APP-274) replaces this later. |
| `DELETE /b/:id` | Appends `removed` (spam). Needs the admin token. |

**Callbacks.** When an answer is added to a bid that has a `callback_url`,
the site POSTs the bid's public shape (JSON) there, once per new answer,
after replying to the answer route. One attempt with a 5-second timeout and
no redirects; a failure is logged and nothing else. Only `https` addresses
outside `yourlore.dev` and its subdomains are accepted, so a callback can't
loop back into the site.

**No route sets `filled`.** Only the payment rail does that, through MON-054:
checkout's webhook over a service binding, or a Base lookup.

## Validation errors

Each error is a 400 with `{error: "<plain sentence>"}` for JSON, or the
form shown again with the message for a form post. Examples: "Write a
question of at least 10 characters." "Bids are $5 to $1,000." "The
callback address can't be on yourlore.dev."
