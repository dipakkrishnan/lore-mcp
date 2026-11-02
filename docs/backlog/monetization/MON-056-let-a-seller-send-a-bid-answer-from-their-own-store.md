---
id: MON-056
title: Let a seller send a bid answer from their own store, with no admin token
priority: P1
effort: M
component: monetization
status: ready
related: [APP-274, MON-051, XC-115, XC-118]
blockers: []
dependencies: [MON-051, APP-274]
github_issue: null
created: 2026-11-01
updated: 2026-11-01
---

## Problem

APP-274 drafts a seller's answer to a bid on their Mac, but `POST /b/:id/answers` takes only
the admin token, so the answer can't reach the bid without Lore's owner adding it by hand
(MON-055). A per-seller secret would be one more thing to mint, store and leak.

## Proposed approach

The answer is a piece on the seller's own registered store, and only the seller can put a piece
there, so that is the proof. The steps are in contracts/bids.md under "Sending a seller's
answer":

- The app posts `{piece_url}` with no token once the approved piece is pushed.
- The site finds the registry seller whose store owns the URL; the handle is their registry name.
- The site reads that store's free catalog (as `site/src/markets.js` does) and accepts only a
  piece listed there with `bid` equal to this bid's id. Preview and price come from the catalog.
- One answer per bid and piece, rate-limited, live bids only.

That needs the store's manifest to carry each piece's `bid` (the Python export and the store
Worker's `discover`); the desktop app already keeps it on the piece (APP-274).

## Acceptance criteria

- [ ] A piece approved as the answer to a bid and pushed to a registered store is listed on the bid by its handle, with no token.
- [ ] A piece whose catalog entry names a different bid, or none, is refused, and so is a URL no registered store owns.
- [ ] The preview and price shown are the catalog's, whatever the request body says.
- [ ] Posting the same piece twice adds one answer.

## Notes

Nov 1: designed while building APP-274's matching and drafting. The admin path stays for MON-055.
