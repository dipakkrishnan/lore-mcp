---
id: APP-224
title: Reconnect a store this Mac didn't set up
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-223, XC-069, APP-215]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-11-13
---

## Problem

A returning owner on a new Mac signs in to the Cloudflare account that already
has their Lore store. Lore only says "This Cloudflare account already has a Lore
store. Sign in with a different account, or reconnect that store from the Mac
that set it up." The owner can't use their own store from the new Mac, and
nothing in the app tells them how to bring it over.

## Proposed approach

A deliberate "Reconnect your existing store" step, separate from putting a new
store online. The owner confirms it is their store on a card that names it. Lore
then adopts its database and Worker without wiping what is on it: no push that
replaces its publications with this Mac's empty set, and its selling state read
from the store, not guessed. The first-run chat and Connectors offer it where
they now show the plain message.

## Acceptance criteria

- [ ] A returning owner can reconnect their store from a new Mac without losing its publications, sales or agent keys.
- [ ] Nothing adopts an existing store without the owner's explicit yes on a card that names it.
- [ ] Putting a new store online never reuses or writes to an existing database or Worker.

**Plan review (2026-11-13), flagged back to in-review:** Not implemented. The
first criterion can't be met as written, and the plan has open design
questions:

- "Without losing its … agent keys": the inbox private key lives only in the
  first Mac's Keychain (`lore/inbox.py` `Credentials`). CAP-039 (merged) now
  refuses to replace a store's key from a Mac that doesn't hold it. A new Mac
  can't read waiting saves unless the key is carried over: exported from the
  old Mac, through a pairing step, or as a deliberate key rotation that gives
  up what is waiting. The item has to pick one.
- "Without losing its publications": publications live in this Mac's
  `lore.db` and every push is a full replace (`_push_sql`). Adopting a store
  needs a pull of `publications`/`collections` from D1 into the local store
  first, or a guarantee that no push runs until one exists. Neither is
  specified, and the second blocks the owner from selling.
- Sales are read from D1 (`deploy._read_all`), so they survive. The local
  `selling` choice would be read from `node_settings`.
- The card that names the store needs a defined source for the name
  (`listed_name` in `node_settings`, the workers.dev URL).
- Effort is closer to L than M. Consider splitting: adopt the Worker and D1
  without pushing; pull the publications; carry or rotate the inbox key.
