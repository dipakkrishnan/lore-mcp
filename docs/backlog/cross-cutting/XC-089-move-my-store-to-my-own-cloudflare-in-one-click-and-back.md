---
id: XC-089
title: Move my store to my own Cloudflare in one click, and back
priority: P2
effort: M
component: cross-cutting
status: ideation
related: [XC-088, XC-071, APP-224]
blockers: [XC-088]
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Owner-owned infrastructure (no single point of failure) stays the strategic goal once
sign-up is hosted; owners need a way to take their store with them, and existing
workers.dev owners need a way in.

## Proposed approach

Settings › "Run your store on your own Cloudflare": the hardened setup path from the
account-ready ticket, then one signed push of the same bundle to the owner's store, a drain of
sealed saves still waiting, and the stable `yourlore.dev/<handle>` names forwarding so
agent links never change. The reverse move uses the same signed push.

## Acceptance criteria

- [ ] After a move, Claude/Grok keep saving without reconnecting; no save is lost in between.
- [ ] Pieces, price and payout arrive unchanged and still verify against the owner's key.
- [ ] The hosted copy is deleted after a 30-day forward; the owner is told when.
- [ ] A failed move leaves the hosted store working exactly as before.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
