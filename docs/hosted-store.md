# One hosted store for everyone

Supersedes the options in DOC-003 (`docs/hosted-nodes.md`, PR #371). Written
2026-10-19.

## The idea

Every owner's store runs inside one service Lore operates at yourlore.dev.
Putting a store online is one tap in the app: no Cloudflare account, no
deploy, no npm, no workers.dev address.

| What | Where |
|---|---|
| Storefront | `yourlore.dev/<handle>` |
| Buyer MCP | `yourlore.dev/<handle>/mcp` |
| Agent inbox | `yourlore.dev/<handle>/agent` |
| Marketplace | `yourlore.dev/market`, read from the same service |

The marketplace stops being a GitHub registry with a daily refresh. A push
lists the store at once, and a take-down removes it at once.

## Rules

1. **The private library never leaves the Mac.** Only two things ever reach
   the service: pieces the owner approved to sell, and agent saves on their
   way to the Mac.
2. **Lore never holds money.** x402 pays the owner's wallet, and cards settle
   on the owner's own Stripe account, as they do today.
3. **No store can read another store's data.** Each store is its own Durable
   Object with its own SQLite database, so isolation comes from how the data
   is stored, not from a `WHERE tenant = ?` that someone can forget.
4. **Only the owner's Mac can change a store.** It holds the store's signing
   key, and nothing else can.

## What is stored, and who can read it

| Data | Stored as | Who can read it |
|---|---|---|
| Free parts, titles, prices | Plain | Anyone, on purpose |
| Agent saves | Sealed to the owner's X25519 key on arrival (`seal.ts`, unchanged). Deleted once the Mac collects them, and after 30 days at most. | Only the owner's Mac. The service sees a save only while the request that carries it is running, and never stores or logs it in the clear. |
| Paid parts | AES-256-GCM at rest, under a per-store key derived from a Worker secret | The running service, only to answer a paid request. A buyer has to get the piece while the owner's Mac is asleep, so the service must be able to open it, the way a shop can see its own stock. A copy of the database alone reveals nothing. |
| Payout address, price, network | Inside a push the owner signed | Anyone can read it, and anyone can check the owner's signature on it |

## Keys

- At sign-up the Mac makes two key pairs and keeps their private halves in
  the Keychain: an Ed25519 key that signs every push, and an X25519 key that
  agent saves are sealed to. Only the public halves go to the service, and
  the handle is bound to them.
- **A push** is a signed bundle: pieces, price, network and payout. The
  service accepts it only with a valid signature from that store's key, so
  there is no push token to leak.
- **Payouts:** the service refuses any payout address that isn't inside a
  signed push. Piece pages show the signed address and the key's
  fingerprint, so a compromised service can't quietly swap one owner's
  payout without breaking a check that a buyer, or Lore's own monitor, can
  run.
- **A lost Mac:** the store stays up, read-only. Re-claiming the handle on a
  new Mac uses the Lore account sign-in plus a recovery code shown once at
  sign-up.
- **Agents** keep their save-only keys, and later OAuth (XC-068). Neither can
  read, publish or sell.

## Running it

- One Worker and one Durable Object class per store on Lore's Cloudflare
  account, plus one small D1 database for the marketplace listing. Today's
  `lore/node` code moves into the Durable Object mostly as it is: the tables
  are the same and only the database calls change.
- Deploys only from CI on `main`. The Cloudflare account has hardware-key
  two-factor sign-in, and no person deploys from a laptop.
- Cost at seeding scale is the $5/mo Workers plan, because Durable Objects
  cost nothing while they're idle.
- Before the first stranger's store lists: rate limits on sign-up per IP and
  per account, the terms and take-down contact (XC-041), and an outside
  review of the key handling.

## What this deletes from the app

Cloudflare sign-in and email verification, wrangler and npm inside the app,
creating D1, deploy and redeploy (along with the redeploy confirm card),
workers.dev addresses, the lore-marketplace registry and its daily refresh.
A push becomes a single HTTPS request.

## Existing stores

Stores on workers.dev keep working. The app offers "Move to yourlore.dev",
which is one signed push and leaves the old address redirecting.
Self-hosting stays possible in code, but isn't offered in the app for now.

## Open decisions

1. Handles: `yourlore.dev/<handle>`, picked at sign-up and changeable once.
2. Is it acceptable that the running service can read paid parts? The only
   alternative is delivering from the owner's Mac, which means no sales
   while it's asleep.
3. Does the Mac's signing key live in the Keychain only, or is it also
   backed up to iCloud Keychain? Backing it up makes changing Macs easy;
   keeping it local is stricter.
