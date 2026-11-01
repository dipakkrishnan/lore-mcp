---
id: XC-088
title: Give every new owner a hosted inbox at yourlore.dev on sign-up
priority: P0
effort: L
component: cross-cutting
status: ideation
related: [XC-071, XC-067, XC-068, XC-041, APP-249]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Even fully hardened, the own-Cloudflare path asks a non-technical owner to create and
verify a Cloudflare account before Claude or Grok can save anything. That is sign-up
friction the owner has ruled out.

## Proposed approach

The inbox slice of XC-071 first: at sign-up the Mac makes Ed25519 + X25519 keys in the
Keychain and claims a handle with their public halves; agents save to
`yourlore.dev/<handle>/agent`, sealed on arrival (`seal.ts`) in that store's own
Durable Object; the Mac collects over signed HTTPS and the object deletes them.
Storefront and selling follow per `docs/hosted-store.md`, behind its review gates.

## Acceptance criteria

- [ ] A new owner picks Claude and gets a working save link in under 10 seconds, with no Cloudflare account.
- [ ] The service never stores or logs a save in the clear; only the owner's Mac can open it. A test proves cross-store isolation.
- [ ] The welcome flow no longer shows any Cloudflare step.
- [ ] Copy says plainly that the owner's key stays on their Mac and they can leave anytime.

## Notes

This is the inbox slice of XC-071, pulled forward because a first-time user failed the own-Cloudflare step on launch day. User-owned Cloudflare stays the goal (XC-089); the hosted inbox only relays sealed saves and never holds keys or money.

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
