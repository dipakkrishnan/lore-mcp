# Hosted inbox contract (XC-088)

An owner with no store of their own on Cloudflare gets one Lore hosts, so
their personal agents can save to Lore in seconds with no account to make.
Lore hosts it and the owner holds the keys, as on Bluesky: the Mac signs
every change, the store seals every save to a key only the Mac has, and the
owner can move to their own Cloudflare later (XC-089).

For now a hosted store is an inbox. Its agent side is exactly
`contracts/inbox.md`: the same `/agent`, tools, tokens, sign-in, sealing and
limits, served by the same code (`lore/node/src/agent.ts`). Only where the
store lives and how the Mac reaches it differ. Selling from a hosted store is
XC-071 and comes later.

## Where things live

- **Worker:** `lore-hosted` (`lore/node/wrangler.hosted.jsonc`,
  `lore/node/src/hosted/`), on Lore's Cloudflare account, deployed only from
  CI on `main`.
- **Address:** `https://<store>.yourlore.dev`, where `<store>` is 12
  characters from `a-z2-7`, made at random by the Mac. It is not a name the
  owner picks, so a later handle never changes an agent's link. Plain `http`
  is redirected to `https`.
- **Storage:** one Durable Object per store, by name, with its own SQLite
  database holding the tables in `contracts/inbox.md`, the sign-in grants
  (`oauth_kv`, in place of a KV namespace), and `owner` and `owner_nonces`
  below. No query reaches another store's database.
- **On the Mac:** the store's id is the `hosted_store` setting. The signing
  key is an Ed25519 key in the Keychain (`Lore` / `hosted owner`); the inbox
  keys stay where `contracts/inbox.md` keeps them. A Mac with a `node_url`
  (its own store) uses that and never the hosted one.

## Claiming: `POST /claim`

Body `{"key": "<b64url Ed25519 public key, no padding>"}`, signed (below)
with that same key.

| Case | Answer |
|---|---|
| Nobody has claimed the store | `200 {"claimed": true}`; the key owns it |
| The same key claims again | `200 {"claimed": true}` |
| Another key holds it | `409 {"error": "this store belongs to someone else"}` |
| Not signed by the key it names | `401` |

A Mac that gets 409 for its recorded store has lost the key it claimed with,
so that store can't be changed any more; it claims a new one. Claims are
limited to 5 a minute per IP address.

A store nobody claimed answers 404 to everything else and writes nothing.

## Signing

Every `/claim` and `/owner/sql` request carries:

| Header | Value |
|---|---|
| `Lore-Time` | Unix time in milliseconds, 13 digits |
| `Lore-Nonce` | 16 random bytes, b64url without padding |
| `Lore-Signature` | Ed25519 signature of the message below, b64url without padding |

```
message = "lore-owner-v1" \n method \n host \n path \n time \n nonce \n hex(sha256(body))
```

`host` is `<store>.yourlore.dev`, so a request signed for one store fails at
every other. The store refuses a time more than five minutes from its own,
and a nonce it has seen in the last ten. `contracts/hosted_owner_vector.json`
is a fixed key and request with its message and signature; both
`lore/hosted.py` and the Worker test against it.

## The owner's statements: `POST /owner/sql`

Body `{"sql": "<statements>"}`, at most 1 MB, signed by the owner's key. The
store runs every statement in one transaction, all or none, and answers
`{"results": [[rows of statement 1], [rows of statement 2], ...]}`, the shape
`wrangler d1 execute --json` gives an owner's own node. A failing statement
answers `400 {"error": "<SQLite's message>"}` and changes nothing.

These are the statements in `contracts/inbox.md` "The Mac side" (mint,
rotate, revoke, waiting, collect, confirm, allow, deny), sent unchanged:
`lore/inbox.py` sends them to whichever store the owner has. The owner can
only reach their own store's database, the same as with their own D1.

## What Lore can and can't do

- **Can't read saves.** They are sealed to the inbox key on arrival and
  stored only as ciphertext (`contracts/inbox.md` "Sealing").
- **Can't change the store as the owner.** Every change is signed by a key
  only the Mac has.
- **Can** delete a store or stop serving it; the owner's library is on the
  Mac either way, and XC-089 moves the store to their own Cloudflare.
- Logs carry requests' paths and statuses, never bodies.
