# Agent inbox contract (XC-067)

An owner's personal agents write into that owner's own seller node (the
`lore/node` Worker in the owner's Cloudflare account). Lore hosts nothing in
between. The Mac collects writes the same way it reads sales: with
`wrangler d1 execute --remote` under the owner's Cloudflare login. Both the
node (TypeScript) and `lore/inbox.py` test against
`inbox_seal_vector.json`.

## Where things live

- **Agent endpoint:** `<node_url>/agent`. It is stateless Streamable HTTP
  MCP, separate from the buyer endpoint `/mcp`, so buyers never see the
  write tools and the write path never touches x402.
- **Storage:** tables in the node's D1 (`lore-publications`). A push replaces
  only `publications` and `node_settings`, so these tables survive every
  push:

```sql
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,                 -- 16 hex
  name TEXT NOT NULL,                  -- 1-40 chars, owner's label
  app TEXT NOT NULL,                   -- grok|muse|chatgpt|claude|other
  token_hash TEXT NOT NULL,            -- hex sha256(secret)
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_saved_at TEXT,
  saved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,                 -- 32 hex
  agent TEXT NOT NULL,
  key_hash TEXT NOT NULL,              -- HMAC-SHA256(salt, agent || ":" || key), hex
  state TEXT NOT NULL CHECK (state IN ('waiting','forgotten','received')),
  sealed TEXT,                         -- null once received
  saved_at TEXT NOT NULL,
  received_at TEXT
);
CREATE TABLE IF NOT EXISTS inbox_windows (
  agent TEXT NOT NULL, span TEXT NOT NULL, started TEXT NOT NULL, used INTEGER NOT NULL,
  PRIMARY KEY (agent, span)
);
```

The node creates them lazily, as it does `sales`. The Mac side creates them
before the first agent is minted, so they exist even on a node deployed
before this version.

- **The owner's keys:** the Mac generates an X25519 key pair and a 32-byte
  HMAC salt, and keeps the private key in the macOS Keychain. `lore push`
  writes `inbox_public_key` and `inbox_salt` (both b64url, no padding) into
  `node_settings` on every push. They are never omitted, because a push
  replaces that table. A node without `inbox_public_key` refuses every
  `/agent` write with "Lore isn't ready for agents on this store yet".

## Tokens

`lore_agent_<agent id>_<secret>`

- `agent id` is 16 lowercase hex characters.
- `secret` is 32 random bytes, base64url without padding (43 characters).
- Parse with `^lore_agent_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$`.
- The Mac mints the token locally and inserts only `sha256(secret)` into
  `agents`. The node compares hashes in constant time.
- The token goes in `Authorization: Bearer <token>`.
- Revoking sets `revoked_at`. Rotating replaces `token_hash` on the same row,
  so the agent id and the memories' provenance stay put.

## Sealing

```
eph      = fresh X25519 key pair
shared   = X25519(eph.private, owner_public)
key      = HKDF-SHA256(ikm=shared, salt=eph.public || owner_public, info="lore-inbox-v1", length=32)
nonce    = 12 random bytes
sealed   = b64url(eph.public || nonce || AES-256-GCM(key, nonce, plaintext, aad=item_id))
```

The plaintext is UTF-8 JSON.

- A save is
  `{"title","content","topic","kind","key","occurred_at"}`. `topic`, `kind`
  and `occurred_at` may be `null`, and `key` defaults to the item id.
- A forget is `{"key": "<key>", "forget": true}`.

The node never stores or logs the plaintext. The inbox lives in the same D1
as the public catalog, so if the buyer surface ever had a bug, only
ciphertext could leak.

## Limits

| Field or quota | Limit |
|---|---|
| `title` | 1–200 characters |
| `content` | 1–20,000 characters |
| `topic` | at most 80 characters |
| `key` | 1–120 characters, trimmed |
| `kind` | `experience`, `lesson`, `preference`, `fact` or `reference` |
| Items per `store` call | 1–20 |
| Writes per agent | 100 an hour, 1,000 a day (windows in `inbox_windows`) |
| Waiting items per node | 2,000 |

A waiting payload older than 30 days is dropped at the next write. A row with no payload left (received, or a dropped forget) is deleted 90 days after it was received or saved, after which `stored` reports its key as `unknown`.

## Replacement and forgetting

- A save whose `key_hash` matches an item still waiting replaces that
  item's `sealed` and `saved_at`, and keeps its id. Otherwise the save gets
  a new item.
- A forget does one of two things:
  - If the key matches a waiting item and no earlier version under that key
    was ever received, the forget drops the waiting item.
  - In every other case, the waiting item (or a new one) becomes state
    `forgotten` with a sealed forget payload, so the Mac removes the memory.
- A received forget keeps state `forgotten`, so `stored` can still report
  it.
- Each saved item counts as one write against the quota, and so does each
  forget.

## Agent MCP: `POST <node_url>/agent`

A request without a valid token gets `401` and
`WWW-Authenticate: Bearer resource_metadata="<node_url>/.well-known/oauth-protected-resource"`.
The metadata document comes with XC-068.

| Tool | Arguments | Result |
|---|---|---|
| `store` | `{"items": [{"title", "content", "topic"?, "kind"?, "key"?, "occurred_at"?}]}` | `{"saved": [{"id", "key", "replaced"}], "note"}` |
| `stored` | `{"keys"?: [...]}` (at most 50) | `{"saved", "waiting", "last_saved_at", "keys": [{"key", "state": "waiting"\|"received"\|"forgotten"\|"unknown", "saved_at"}]}` |
| `forget` | `{"key"}` | `{"forgotten": true}` |

The server's `instructions` say Lore keeps every save private on the
owner's Mac until the owner reviews it in the Lore app, and nothing is ever
published or sold without the owner's approval.

## The Mac side (all through `wrangler d1 execute --remote`)

- **Mint:** insert into `agents`.
- **Rotate:** update `token_hash`.
- **Revoke:** set `revoked_at`.
- **Waiting:** `SELECT agent, count(*) FROM inbox WHERE state IN ('waiting','forgotten') GROUP BY agent`. It is batched into the same wrangler call as the sales check where possible.
- **Collect:** `SELECT id, agent, state, sealed, saved_at FROM inbox WHERE agent = ? AND state IN ('waiting','forgotten') ORDER BY saved_at LIMIT 200`.
- **Confirm:** for each collected `(id, saved_at)`, run `UPDATE inbox SET state = CASE state WHEN 'forgotten' THEN 'forgotten' ELSE 'received' END, sealed = NULL, received_at = ? WHERE id = ? AND saved_at = ?`. It runs only after the import commits. Matching `saved_at` means an agent's re-save between the collect and the confirm survives for the next collection, rather than being dropped unseen.
