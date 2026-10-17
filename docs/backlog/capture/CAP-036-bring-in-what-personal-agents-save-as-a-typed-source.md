---
id: CAP-036
title: Bring in what personal agents save, as a typed source
priority: P0
effort: M
component: capture
status: in-review
related: [XC-067, CAP-037, APP-207, MON-046]
blockers: []
dependencies: [XC-067 inbox API]
github_issue: null
created: 2026-10-16
updated: 2026-10-16
---

## Problem

Once an owner's agents can write to the hosted inbox (XC-067), those writes
have to land in the owner's library with provenance that says which agent
wrote them. They must flow through the same synthesis and approval path as
every other source, and stay current when the agent saves a newer version.

## Proposed approach

- A new reader kind `agent` in `lore/sources.py` (`Kind` literal). A
  `PersonalAgent` connector is registered by subclassing, as every connector
  is. Each connected agent is its own source, named `agent-<agent id>`, with
  the owner's label (for example "Grok") and its `app` (`grok | muse |
  chatgpt | claude | other`). That keeps provenance typed: the source kind
  says "personal agent", the app says which one, and the inbox credential
  vouches for it, not the agent's own claim.
- An `Inbox` client (`lore/inbox.py`) handles the owner side of XC-067:
  - It registers once, generating the X25519 key pair.
  - It keeps the owner token and private key in the Keychain (the `signin.py`
    pattern).
  - It mints and revokes agent tokens, lists waiting items, opens sealed
    items, and confirms receipt.
  - The base URL is `https://inbox.yourlore.dev`, overridable with
    `LORE_INBOX_URL`.
- The reader's `items()` pulls this agent's waiting items. It decrypts them
  and yields one `Item` each, with `key = item key or item id`, so a later
  save under the same key updates the memory in place and flags any
  publication built on it (existing `Store.put` behaviour). `forgotten`
  items remove their memory. Receipt is confirmed only after the import
  commits (at-least-once; the source key dedupes).
- CLI:
  - `lore agents connect <name> --app <app> [--json]` prints the MCP URL, a
    one-time key, and the setup prompt (CAP-037).
  - `lore agents list [--json]`
  - `lore agents revoke <source>` disconnects the agent; it keeps or deletes
    its memories like `sources remove`.
  - `lore agents waiting [--json]` is the cheap check the app polls.
  - Reading uses `lore sources read <name>` as for every source.

## Acceptance criteria

- [ ] `lore agents connect` registers the owner on first use only and returns a working key; the key and private key are never written to SQLite or disk in the clear.
- [ ] Reading an agent source imports its waiting items as private memories whose source names the agent, then confirms receipt; a failed import confirms nothing.
- [ ] A newer save under the same key updates the memory and flags publications that cite it; a forgotten item's memory is removed unless a publication cites it.
- [ ] The catalog, `lore sources list`, and the desktop snapshot show each agent source with its app, last save and count, with no other wiring.
- [ ] Tests run against a local fake of the inbox API; coverage meets the 90% gate.

## Notes

- Agent writes enter as `origin='native'`, so the evening check-in sees them
  like any connected app.
- Agents are also excluded from the check-in by name (`skip`). Check that
  `agent-` sources aren't caught by that.
- Built (Oct 16), on the node design in `contracts/inbox.md`:
  - `lore/inbox.py`: the X25519 key and HMAC salt are made at the first
    mint and kept in the Keychain (`Lore` / `inbox keys`). Agent tokens are
    minted locally, and only their hash reaches D1. The client mints,
    rotates, revokes, lists, counts what's waiting, collects, opens and
    confirms. Every call goes through `deploy._read` (`wrangler d1 execute
    --remote`), the way sales are read. The first mint creates the three
    tables and upserts the keys into `node_settings`.
  - `lore/sources.py`: kind `agent`, `AgentReader`, and the `PersonalAgent`
    connector (`agent`). Each agent is its own source, `agent-<id>`, with a
    new `Source.app` field. `Item.forgotten` and `Store.forget` handle
    forgotten saves; `Reader.settle()` confirms receipt only after the
    import loop, and only the version collected (`saved_at`). Read stats
    gain a `removed` count.
  - `lore/agents.py` and `lore agents connect|list|key|revoke|waiting`.
    `mcp_url` is `node_url` without `/mcp`, plus `/agent`. With no store
    online, connect exits 2. `revoke --keep` brings in what is waiting
    first.
  - `lore push` writes `inbox_public_key` and `inbox_salt` whenever this Mac
    has keys.
  - `tests/fixtures/inbox.py`: D1 as a SQLite file, a wrangler stand-in,
    and an `/agent` server that seals saves, each runnable for the edge
    harness.
- The collect and waiting queries skip rows with no payload (`AND sealed IS
  NOT NULL`), as the contract now says. The token hash is the SHA-256 of the
  secret string, as the node computes it, and a test pins that. The stand-in
  node follows the node's rules in `lore/node/src/inbox.ts`: a dropped
  forget stays as a `forgotten` row with no payload.
- Waiting is its own wrangler call, not batched with the sales read.
- Not checked against the real Worker or a real Cloudflare D1; only against
  the stand-in.

