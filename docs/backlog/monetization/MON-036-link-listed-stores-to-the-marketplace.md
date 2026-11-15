---
id: MON-036
title: Link listed stores to the marketplace and list them on request
priority: P3
effort: S
component: monetization
status: completed
related: [XC-036]
blockers: []
dependencies: []
github_issue: 367
created: 2026-10-04
updated: 2026-11-13
---

## Problem

Listing is the invite: a buyer on one seller's store should find the others,
and a seller who just asked to be listed should show up quickly. A listed
store's pages said nothing about the marketplace, and the README did not
describe how a store gets listed.

## Proposed approach

The node already knows it is listed: `lore marketplace list` pushes the
`listed_name` setting and `delist` clears it (XC-036). The store page and
every piece page show a small "Listed on Lore marketplace" link to
https://yourlore.dev/marketplace while that name is set.

In lore-marketplace, the `refresh` workflow already runs on a **List my
store** issue. It also runs when the `listing` label lands after the issue
opens, so a request whose label arrives late is not left waiting for the
daily run.

The README documents the flow: list, submit the prefilled form, get a reply.

## Acceptance criteria

- [x] A listed node's store and piece pages link to the marketplace; an unlisted node's pages do not
- [x] Submitting a listing request starts a refresh run without manual action
- [x] The README's listing steps match `lore marketplace` and the registry workflow

## Notes

The badge follows the node's own switch, not `marketplace.json`, so it shows
while a request is pending and disappears on the push that delists.

**Review 2026-10-19:** not completed. Listing badge and README shipped (3d8175d). Unverifiable here: a listing request starting a refresh run, which lives in the external lore-marketplace repo.

**Prioritization (2026-11-12):** Priority P3 (was P1). Stays in-review.
Before it can be ready: Nothing to build: a person confirms the lore-
marketplace refresh workflow runs on a listing-labelled issue, then closes
the item. Prioritization flag (not acted on): done.

**Close-out (2026-11-13):** Completed. Evidence:
- Badge: `listed()` in `lore/node/src/storefront.ts` adds "Listed on Lore
  marketplace" to the store and piece pages only while the listed name is
  set. `lore/node/test/unit/storefront.test.ts` pins both pages, listed and
  unlisted. Shipped in #370 (3d8175d0).
- Refresh on request: the lore-marketplace repo's
  `.github/workflows/refresh.yml` runs on `issues: [opened, labeled]` when the
  issue carries `listing`. A real request, lore-marketplace issue #4
  (2026-10-07), started two `issues`-event refresh runs, both successful. The
  bot replied "Listed. …" and closed the issue as completed, with no manual
  action.
- README: the "Listing" section in `README.md` matches `lore marketplace
  list/status/delist` and that workflow (prefilled List my store form, reply
  on the request, delisted entries dropped at the daily refresh).
