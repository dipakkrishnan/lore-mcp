---
id: MON-048
title: Let buyers ask for a piece and offer a price
priority: P2
effort: M
component: monetization
status: ideation
related: [XC-093, XC-074, MON-044]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Sellers don't know what's worth publishing, and visitors can't see demand. That's why "why would
someone buy this?" has no answer on the site. a first user's first suggestion was getting people to place
offers on the app, possibly in bulk.

## Proposed approach

Manual first cut: an "Ask for a piece" form on /marketplace (question, offered price, optional
email, "for a team or in bulk" checkbox) that opens a request in lore-marketplace. Approved
requests list on /marketplace as "Wanted". Dipak points matching sellers at them by hand. Only
after requests arrive, show matching requests in the app's For Sale view and let a seller answer
one with a piece.

## Acceptance criteria

- [ ] A visitor can submit a request without an account; spam is filtered before it lists.
- [ ] /marketplace shows open requests with their offered price.
- [ ] A bulk or team request reaches Dipak's inbox.
- [ ] After four weeks, the number of requests and requests filled is recorded so the in-app step is a decision, not a guess.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
