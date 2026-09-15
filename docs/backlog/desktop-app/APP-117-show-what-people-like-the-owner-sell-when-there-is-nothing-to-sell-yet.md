---
id: APP-117
title: Show what people like the owner sell when there is nothing to sell yet
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-109, APP-092, CAP-003, MON-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-14
updated: 2026-09-14
---

## Problem

The For Sale empty state (`APP-109`) names the next action but gives no
picture of what a good publication is. Zane's ask: "give me examples of
high-selling lores. Or if it knows my job title it can show me what people
in a role similar to me typically post about." With one sale on the whole
network there is no real "high-selling" list, so the examples have to be
curated, honest about that, and keyed to the owner's persona and topic
outline from the blueprint.

## Proposed approach

A small curated set of example publications, six to nine, each the shape the
buyer thesis says sells: a specific recent thing that happened to someone,
with the lesson attached, dated, firsthand. Tag each with a persona and a
domain. The For Sale empty state and the publish card's blank state show the
two or three nearest the owner's blueprint (persona, topic outline) under a
plain heading, "Publications that do well look like this", with the note that
these are examples, not a leaderboard. When `MON-018` sold counts exist
across enough nodes, the curated set gives way to real ones; keep the render
path the same. Shane's and Dipak's live publications are the first examples.

## Acceptance criteria

- [ ] For Sale with nothing published shows two or three examples matched to
      the owner's persona, each one sentence of teaser plus why it sells.
- [ ] An owner with no blueprint sees the general set.
- [ ] Copy says they are examples; nothing claims a sales figure that the
      ledger cannot back.

## Notes

Zane's "67% quality" rating is `XC-032`; this item is the reference picture,
that one is the per-draft check.
