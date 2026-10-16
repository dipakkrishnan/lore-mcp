# Agent inbox contract (XC-067)

The wire contract between the hosted inbox Worker (`inbox/`), the owner side
in `lore/inbox.py`, and agents. Both implementations test against
`inbox_seal_vector.json`.

Base URL: `https://inbox.yourlore.dev`. The owner side can override it with
`LORE_INBOX_URL`.

## Tokens

`lore_<role>_<owner>_<secret>`

- `role` is `owner` or `agent`.
- `owner` is 32 lowercase hex characters.
- `secret` is 32 random bytes, base64url without padding (43 characters).
- Parse with `^lore_(owner|agent)_([0-9a-f]{32})_([A-Za-z0-9_-]{43})$`.
- The server stores only `sha256(secret)` (hex) and routes to the owner's
  Durable Object by `owner`.
- Every token goes in `Authorization: Bearer <token>`.

Ids:
- Agent ids are 16 hex characters.
- Item ids are 32 hex characters.
- Times are ISO 8601 UTC strings.

## Sealing

Items are sealed to the owner's X25519 public key, which the owner side
generates and keeps private.

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

The Worker keeps no copy of the plaintext: it is not stored, and it is never
logged.

## Limits

| Field or quota | Limit |
|---|---|
| `title` | 1–200 characters |
| `content` | 1–20,000 characters |
| `topic` | at most 80 characters |
| `key` | 1–120 characters, trimmed |
| `kind` | `experience`, `lesson`, `preference`, `fact` or `reference` |
| Items per `store` call | 1–20 |
| Writes per agent | 100 an hour, 1,000 a day |
| Waiting items per owner | 2,000 |
| `name` | 1–40 characters |
| `app` | `grok`, `muse`, `chatgpt`, `claude` or `other` |

A waiting payload is dropped after 30 days.

## Keys and replacement

The server never stores a plaintext `key`. It keeps
`key_hash = HMAC-SHA256(owner_salt, agent_id || ":" || key)` for
replacement and forgetting. `owner_salt` is random per owner and is kept in
the Durable Object.

- A save whose `key_hash` matches an item still waiting replaces that
  item's sealed payload and `saved_at`, and keeps its id. Otherwise the save
  gets a new item.
- A forget whose key matches a waiting item drops that item. Otherwise it
  becomes a new waiting item in state `forgotten`, so the Mac removes the
  memory.

## Owner API

Every route except `POST /owners` needs the owner token. Errors are
`{"error": "<message>"}` with 400, 401, 404, 409, 413 or 429.

| Route | Body | Response |
|---|---|---|
| `POST /owners` | `{"public_key": b64url(32 bytes)}` | `201 {"owner", "token"}`. Rate-limited per IP. |
| `GET /owners/me` | | `200 {"owner", "waiting", "agents": [Agent]}` |
| `POST /owners/me/agents` | `{"name", "app"}` | `201 {"agent": Agent, "token", "mcp_url"}`. The token is shown only once. |
| `POST /owners/me/agents/:id/key` | | `200 {"token"}`. Issues a new token for the same agent, and the old token stops working at once. |
| `DELETE /owners/me/agents/:id` | | `204`. The agent's token stops working at once. Its waiting items are kept until they are collected. |
| `GET /owners/me/items?agent=<id>&limit=<1-200, default 100>` | | `200 {"items": [{"id", "agent", "state": "waiting"\|"forgotten", "sealed", "saved_at"}]}`, oldest first |
| `POST /owners/me/items/received` | `{"ids": [...]}` (at most 200) | `204`. Drops each item's payload; the row becomes `received`. Unknown ids are ignored. |
| `DELETE /owners/me` | | `204`. Everything is erased. |

`Agent` is:

```
{"id", "name", "app", "created_at", "last_saved_at", "saved", "waiting", "revoked": bool}
```

## Agent MCP: `POST /mcp`

Streamable HTTP, stateless, with the agent token. A request without a valid
token gets `401` and
`WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource"`.
The metadata document comes with XC-068.

| Tool | Arguments | Result |
|---|---|---|
| `store` | `{"items": [{"title", "content", "topic"?, "kind"?, "key"?, "occurred_at"?}]}` | `{"saved": [{"id", "key", "replaced"}], "note"}` |
| `stored` | `{"keys"?: [...]}` (at most 50) | `{"saved", "waiting", "last_saved_at", "keys": [{"key", "state": "waiting"\|"received"\|"forgotten"\|"unknown", "saved_at"}]}`. `keys` is the arguments echoed back with their latest state. |
| `forget` | `{"key"}` | `{"forgotten": true}` |

`store` returns its `key` as the agent sent it. The server knows that value
only for the length of the request.

The server's `instructions` say Lore keeps every save private until the
owner reviews it in the Lore app, and nothing is ever published or sold
without the owner's approval.
