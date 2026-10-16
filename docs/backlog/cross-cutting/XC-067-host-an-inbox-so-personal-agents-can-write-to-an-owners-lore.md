---
id: XC-067
title: Host an inbox so personal agents can write to an owner's Lore
priority: P0
effort: L
component: cross-cutting
status: in-progress
related: [CAP-036, CAP-037, APP-207, XC-068, MON-046, XC-044, CAP-009]
blockers: []
dependencies: [inbox.yourlore.dev route on Lore's Cloudflare account, a deploy workflow environment holding CLOUDFLARE_API_TOKEN]
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/467
created: 2026-10-16
updated: 2026-10-16
---

## Problem

It is hard to get people to put their context into Lore by hand, even with a
good interface. Their context already sits in their personal agents (Grok,
Muse, ChatGPT, Claude). Those agents run in the cloud and attach only remote
MCP servers over public HTTPS. They cannot reach the owner's Mac. Lore has no
hosted owner identity and no write surface at all: every seller node is
read-and-buy only, and the desktop app talks to its node through wrangler.

## Proposed approach

A new Worker, `inbox/` (`lore-inbox`, at `https://inbox.yourlore.dev`), on
Lore's own account. It holds what an owner's agents write until the owner's
Mac collects it. It never publishes or sells anything.

**Identity.** An owner is a random id plus a secret. The desktop registers
once, sending an X25519 public key; the private key and the owner secret stay
in the macOS Keychain. Tokens embed the owner id so the Worker can route to
the owner's Durable Object without a global table:
`lore_owner_<owner>_<secret>` and `lore_agent_<owner>_<secret>`. Only
SHA-256 hashes of secrets are stored. An agent token is scoped to writing
into that one owner's inbox and reading back its own writes.

**Storage.** One SQLite-backed Durable Object per owner (`Inbox`):
`agents(id, name, app, token_hash, created_at, revoked_at, last_saved_at,
saved)` and `items(id, agent, key, state, sealed, saved_at, received_at)`.
An item is sealed to the owner's public key on arrival (ephemeral X25519,
HKDF-SHA256 with info `lore-inbox-v1`, AES-256-GCM;
`sealed = b64url(epk ‖ nonce ‖ ciphertext)`), so stored items are readable
only on the owner's Mac. Plaintext exists in Worker memory only for the
length of the request. The payload is dropped once the Mac confirms receipt;
the row stays as a short record of what happened (`waiting` → `received`, or
`forgotten`). Payloads still waiting after 30 days are dropped by an alarm.

**Owner API** (owner bearer token):
- `POST /owners {public_key}` → `201 {owner, token}`. Rate-limited per IP.
- `GET /owners/me` → `{agents: [...], waiting}`.
- `POST /owners/me/agents {name, app}` → `201 {agent, token}`. The token is
  shown once.
- `DELETE /owners/me/agents/:id` → `204`. It revokes the token now.
- `GET /owners/me/items?agent=&limit=` → sealed waiting items.
- `POST /owners/me/items/received {ids}` → `204`.
- `DELETE /owners/me` → `204`. Everything is erased.

**Agent MCP** at `/mcp` (Streamable HTTP, `Authorization: Bearer
lore_agent_…`). An unauthenticated call gets `401` with `WWW-Authenticate`,
which leaves room for XC-068. Tools:
- `store {items: [{title, content, topic?, kind?, key?, occurred_at?}]}` takes
  1–20 items. It saves them privately for the owner. Saving again under the
  same `key` replaces the earlier version, which is how an agent keeps
  context current. `kind` is one of `experience | lesson | preference | fact
  | reference`.
- `stored {limit?}` lists this agent's recent writes and their state, so it
  can tell the owner what reached Lore.
- `forget {key}` withdraws a write that is still waiting, or marks it so the
  Mac removes it on the next collection.

The server `instructions` say that nothing is ever sold or published without
the owner's approval in the Lore app.

**Limits.** Each item can have a title of up to 200 characters and content
of up to 20,000 characters. Each agent can make 100 writes an hour and 1,000
a day. Each owner can have 2,000 waiting items. The counters are held in the
Durable Object (it is the only truly global bound, per `feedback-relay`);
Rate Limiting bindings cover IP-level abuse.

## Acceptance criteria

- [ ] An owner registers, mints an agent token, and that agent's `store` call puts sealed items in the inbox; the owner's token reads them back, and they decrypt with the owner's private key only.
- [ ] A revoked or wrong token gets 401, and one owner's token never reads or writes another owner's inbox (tested).
- [ ] The same `key` saved twice leaves one waiting item, holding the newer content.
- [ ] `received` drops the payload; `stored` then reports `received`; a payload waiting past 30 days is dropped.
- [ ] Quotas and size limits reject with a clear tool error that names the limit.
- [ ] No plaintext item content is logged, and none is stored at rest (tested against the DO's tables).
- [ ] The Worker deploys from CI to `inbox.yourlore.dev` like `feedback-relay`, and is never deployed by hand without the owner's go-ahead.

## Notes

- Grok Bot's custom connector form takes a name, a public HTTPS URL and
  headers, and does not sign in with OAuth in the current beta. So a bearer
  agent token is enough for the first demo. grok.com, Claude, ChatGPT and
  Muse expect MCP OAuth with dynamic client registration: that is XC-068.
- Why sealed: while it waits, the inbox holds an owner's private context.
  Lore should not be able to read it at rest, and a database leak should
  yield nothing.
- Prior art in the repo: the `feedback-relay` layered limiter and Durable
  Object quota, checkout's HMAC seller token (which is stateless and can't
  be revoked, so it is not reused here), and `lore/signin.py` Keychain
  storage.
