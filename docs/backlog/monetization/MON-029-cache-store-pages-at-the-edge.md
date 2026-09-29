---
id: MON-029
title: Cache store pages at Cloudflare's edge so crawlers can't exhaust the seller's quota
priority: P1
effort: S
component: monetization
status: in-review
related: [XC-040, MON-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

Every request for `/` or `/p/<id>` runs the seller's Worker and queries D1.
`cache-control: public, max-age=60` only helps browsers: Cloudflare doesn't
store Worker responses at its edge unless the Worker uses the Cache API. Now
that the marketplace page links to stores, crawlers and browsing agents will
hit these pages. The seller's Workers free tier (about 100k requests a day)
is shared with the paid `/mcp` endpoint, so a crawl can stop sales or run up
the seller's bill.

## Proposed approach

In `lore/node/src/index.ts`, wrap the page branch with `caches.default`:
look up by URL and serve a hit; on a miss, render, `ctx.waitUntil(cache.put)`,
and return. Keep HEAD on the same path. Never cache a response that carries
unlocked content (XC-039). Consider a short `s-maxage`, and clearing the
cache on `lore push`.

## Acceptance criteria

- [ ] A second request for `/` or `/p/<id>` within the TTL is served without
      a D1 query (tested).
- [ ] 404s are cached briefly or not at all, so a newly pushed piece appears
      within the TTL.

## Notes

Raised 2026-09-29 alongside the PR #341 deploy. Check the free-tier number
against Cloudflare's current limits before quoting it to sellers.
