---
id: APP-224
title: Reconnect a store this Mac didn't set up
priority: P2
effort: M
component: desktop-app
status: ready
related: [APP-223, XC-069, APP-215]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-18
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
