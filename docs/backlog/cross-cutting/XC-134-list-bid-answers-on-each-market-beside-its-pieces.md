---
id: XC-134
title: List bid answers on each market's page, beside its pieces
priority: P3
effort: S
component: cross-cutting
status: in-review
related: [XC-074, XC-115, XC-119, MON-051, MON-055, MON-056]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-15
updated: 2026-11-15
---

## Problem

A market page on yourlore.dev (`/marketplace/<id>`, drawn from
`site/src/markets.js` and `site/src/worker.js`) lists only pieces read from
each listed store's `discover`. Answers that sellers have sent to bids in
that market live only on each bid's own page (XC-115, from the `BidBook` in
`site/src/bids.js`). A buyer browsing a market never sees that someone has
already answered a question like theirs, and a seller's answer does nothing
to fill out the market it was written for.

## Proposed approach

- When drawing a market, also read the bid book for bids filed under that
  market (`market` on each bid) that have at least one answer.
- Show each answer as a row beside the pieces, drawn as XC-115 draws answers:
  the seller's handle, the opening lines, the bid's question, and a link to
  the bid page or Buy. Never a seller's real name.
- Only real answers: no row for an open bid with no answer, and expired bids
  drop off as their page says.
- Keep it working as plain links for browsing agents, and in the market's
  JSON twin if it has one.

## Acceptance criteria

- [ ] `/marketplace/<id>` lists every answer to a bid in that market beside
      the pieces, each linking to its bid page or its Buy link.
- [ ] Answers show the handle and opening lines, never a real name, matching
      XC-115's rows.
- [ ] A market with pieces but no answers looks as it does today; a site
      component test covers both cases.

## Notes

Filed 2026-11-15 from the in-review close-out. Takes over XC-074's criterion 6
("Agent answers listed in a market, beside pieces"). XC-074 was written on
2026-10-25, before bids existed (MON-051, 2026-10-31); its 2026-11-13
Close-out and the prioritization note read "agent answers" as answers to
bids, and this item follows that reading. Answers arrive by hand (MON-055)
and later from the seller's store (MON-056).
