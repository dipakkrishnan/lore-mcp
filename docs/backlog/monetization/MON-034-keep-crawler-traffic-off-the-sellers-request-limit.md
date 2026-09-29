---
id: MON-034
title: Keep crawler traffic off the seller's Workers request limit
priority: P2
effort: M
component: monetization
status: in-review
related: [MON-029, XC-040]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

Every visit to a seller's store page counts against the seller's Workers
request limit. That includes visits served from Workers Cache (MON-029). On
the free plan the limit is 100,000 requests a day, unverified, and the paid
`/mcp` endpoint shares it. The marketplace page links to every store, so as
crawlers and browsing agents find them, heavy crawling could stop sales or
push a seller onto a paid plan.

## Proposed approach

Unclear; needs investigation. The candidates:
- Serve the public pages from Lore's own site
  (`yourlore.dev/s/<handle>`), rendered from each store's free `discover` and
  cached in Lore's zone. The seller's Worker then only answers `/mcp`. This
  also gives stores a cleaner address that doesn't expose the seller's
  Cloudflare subdomain.
- Or add a `robots.txt` with crawl limits for well-behaved crawlers. This
  does nothing against the rest.

## Acceptance criteria

- [ ] Choose an approach and record it here.
- [ ] A burst of page views on a store doesn't consume the seller's request
      limit, or the limit it can consume is bounded and documented.

## Notes

Split from MON-029 on 2026-09-29, after finding that Workers Cache hits are
billed as requests
(https://developers.cloudflare.com/workers/cache/). Check the current
free-plan request limit before quoting it to sellers.
