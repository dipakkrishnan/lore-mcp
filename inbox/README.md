# Lore inbox

A Lore-hosted Cloudflare Worker (`lore-inbox`, at `https://inbox.yourlore.dev`)
that holds what an owner's personal agents (Grok, Muse, ChatGPT, Claude) save,
until the owner's Mac collects it. It never publishes or sells anything. Backlog
item `XC-067`; the wire contract is `contracts/inbox.md`, and both sides test
against `contracts/inbox_seal_vector.json`.

Every item is sealed to the owner's X25519 public key on arrival (X25519,
HKDF-SHA256, AES-256-GCM), so the inbox cannot read what it holds. Plaintext is
never stored or logged. One SQLite-backed Durable Object (`Inbox`) per owner
holds the owner row, agents, items and quota windows, and is the only authority
for tokens and quotas. Payloads are dropped once received, or after 30 days.

## Routes

- `POST /owners`, rate-limited per IP; everything under `/owners/me` takes the
  owner token. See `contracts/inbox.md` for the table.
- `POST /mcp`: stateless Streamable HTTP for agents, with the agent token.
  Tools `store`, `stored`, `forget`. A missing or invalid token gets `401` with
  `WWW-Authenticate: Bearer resource_metadata=...` (the metadata is XC-068).

## Tests

```sh
npm ci
npm test        # vitest in workerd, with a real MCP client over the fetch handler
npm run lint
npm run check   # tsc --noEmit
```

## Deploy

`.github/workflows/deploy-inbox.yml` deploys on every push to `main`, from the
protected `inbox` GitHub Environment holding `CLOUDFLARE_API_TOKEN`. Until that
secret is set, the job warns and skips. There are no Worker secrets. Never
deploy by hand without the owner's go-ahead.
