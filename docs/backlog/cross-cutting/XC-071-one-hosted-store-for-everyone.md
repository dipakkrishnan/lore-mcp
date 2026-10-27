---
id: XC-071
title: One hosted store for everyone at yourlore.dev, sealed and signed
priority: P0
effort: L
component: cross-cutting
status: ideation
related: [XC-067, XC-068, XC-069, XC-041, XC-036, MON-025, APP-224]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-19
updated: 2026-10-19
---

## Problem

An owner's agents can only save to Lore once the owner runs their own store
on their own Cloudflare account. That means a Cloudflare sign-up, email
verification (which took about four hours to register on Oct 18), a deploy
and a workers.dev address. Most people quit at an unfamiliar account, and
nobody asked to run a server.

## Proposed approach

Follow `docs/hosted-store.md`.

- One service at yourlore.dev. Each store is its own Durable Object.
- Agent saves stay sealed to the owner's key.
- Paid parts are encrypted at rest.
- Every push is signed by the owner's Mac.
- The marketplace reads the same service.

## Acceptance criteria

- [ ] A new owner puts a store online from the app with no Cloudflare account, in one tap.
- [ ] Grok Bot, Claude and ChatGPT save to `yourlore.dev/<handle>/agent`. Only that owner's Mac can open the saves.
- [ ] One store can't read another store's data. A test proves it.
- [ ] The service rejects a push or payout change unless the owner's Mac signed it.
- [ ] Neither the database nor the logs ever hold the plaintext of an agent save or a paid part.
- [ ] A store is listed on the marketplace as soon as it pushes, and unlisted as soon as it takes down.
- [ ] An existing workers.dev store moves over with one confirm and keeps its old address redirecting.
- [ ] Before any stranger's store lists, the key handling has had an outside review and the XC-041 terms are live.

## Notes

- 2026-10-19: replaces DOC-003's shared-table design, where every store's
  rows sit in one table with a tenant column. With one Durable Object per
  store, a missed `WHERE` can't leak another store's data. The open
  decisions are listed at the end of `docs/hosted-store.md`.
