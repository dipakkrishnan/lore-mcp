---
id: XC-040
title: Give browsing agents a store page per piece and a marketplace page
priority: P1
effort: M
component: cross-cutting
status: in-progress
related: [XC-031, XC-034, XC-036, XC-037, XC-039, MON-018]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

Personal agents like Instinct find and buy things by browsing the web, so a
store has to be a page an agent can read. A seller's store page at `/` was a
read-only list of teasers that didn't name the seller. It had no page per
piece and no machine-readable price. Nothing listed every seller in one
place. `marketplace.json` is a raw file in a GitHub repo, and yourlore.dev
was only the download page. An agent had nothing to link to, nothing to
parse for price, and nowhere to start looking.

## Proposed approach

- **Store (`lore/node/src/storefront.ts`):**
  - The page names the seller and groups pieces by topic, with the teaser as
    each card's headline.
  - Each piece gets its own page at `/p/<id>`.
  - Both pages carry schema.org `Product`/`Offer` JSON-LD.
  - Only what `discover` already gives away appears: never the title, the
    text, or an unapproved piece.
  - Test-network stores say so and advertise no Offer.
- **Marketplace (`site/src/worker.js`):** yourlore.dev/marketplace is
  rendered on the server from the lore-marketplace seller list, with one
  card per seller linking to their store. It shows only well-formed entries
  with an https store, and falls back to a "can't be loaded" page.
- The marketplace stays a list of sellers. Anything that needs items reads
  the stores.

## Acceptance criteria

- [x] `/` and `/p/<id>` render from the store's catalog without the title or
      the text. Route tests pin this against the seeded fixture.
- [x] HEAD, a trailing slash and any miss under `/p` get the store's own HTML
      404, not the MCP handler.
- [x] JSON-LD is escaped against `</script>` breakout. Unlisted stores name
      no seller, and test stores offer nothing.
- [x] One malformed or `javascript:` entry in `marketplace.json` can't break
      or hijack the marketplace page. Node tests cover this.
- [ ] yourlore.dev deployed with `/marketplace` live, and the home page and
      download link unchanged.
- [ ] The maintainer's store redeployed and serving the new pages.

## Notes

Implemented in PR #341 (the redesign, plus review fixes in 29ea9f90).
Titles stay private: the Python catalog excludes them by construction, and
the teasers already read as headlines. Card checkout on `/p/<id>` is XC-039.
The unlocked response it adds must be `private, no-store`, because the free
page is `public, max-age=60`.
