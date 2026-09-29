---
id: MON-029
title: Serve store pages from Cloudflare's edge cache without running the Worker
priority: P1
effort: S
component: monetization
status: in-progress
related: [XC-040, MON-018, MON-034]
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

Turn on Workers Cache (`"cache": { "enabled": true }` in
`lore/node/wrangler.jsonc`). Unlike the Cache API, it works on `workers.dev`,
and a hit is served without invoking the Worker. Store pages already send
`public, max-age=60`. Every other response the Worker returns gets
`no-store` unless it already sets `Cache-Control`, because Workers Cache
also caches heuristically when that header is missing.

## Acceptance criteria

- [x] Store pages are sent `public, max-age=60`, and every other response is
      `no-store` or `no-cache` (tested in `test/pages.test.ts`).
- [x] 404s are cached for at most the same 60 seconds, so a newly pushed
      piece appears within that time.
- [ ] After a deploy, a second request for `/` or `/p/<id>` within 60 seconds
      returns `cf-cache-status: HIT`, which means the Worker and D1 were
      skipped. Workers Cache can't run in the vitest pool, so this is checked
      live.

## Notes

Raised 2026-09-29 alongside the PR #341 deploy.

Implementation, 2026-09-29: the item's premise was half wrong.
- The Cache API (`caches.default`) is a no-op on `workers.dev`, where every
  seller's store runs. Workers Cache is the mechanism that works there
  (https://developers.cloudflare.com/workers/cache/).
- Cache hits are still billed as Worker requests, so no cache protects the
  seller's daily request limit. What caching saves is D1 reads, CPU time and
  latency.
- Protecting the request limit was split off as MON-034.
- The cache key includes the Worker version, so a deploy clears it. A
  `lore push` doesn't redeploy the Worker, so pages can stay up to 60 seconds
  stale after a push.
