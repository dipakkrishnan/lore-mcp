---
id: XC-041
title: Publish seller terms, a privacy policy update and a takedown process
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [XC-040]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-29
updated: 2026-09-29
---

## Problem

Lore now distributes sellers' content on public pages, and with card
checkout it becomes a Stripe platform. Sellers sell what they learned
firsthand, which is often learned at work and may be covered by an NDA or
belong to an employer. Lore has no seller terms. Nothing says a seller must
own what they sell and have the right to sell it. There is no channel for
copyright complaints and no process for removing a listing. Stripe's platform
review will also ask for terms and a privacy policy.

## Proposed approach

- Draft seller terms: the seller owns the content and has the right to sell
  it; no confidential information; Lore can delist a store; fees may apply
  later.
- Update PRIVACY.md to cover payment data and the public pages.
- Set up a takedown address and a delisting procedure. Lore can't delete
  anything from a seller's own Worker, so a takedown means removing the
  listing from marketplace.json and asking the seller to unpublish.
- Have the owner accept the terms in the desktop app before listing.
- At publish time, remind sellers not to publish anything learned under an
  NDA.

## Acceptance criteria

- [ ] The terms and a takedown contact are published on yourlore.dev and
      linked from the marketplace and store pages.
- [ ] Listing a store requires accepting the terms.
- [ ] A dry-run takedown removes a listing from marketplace.json.

## Notes

Raised 2026-09-29. Required before the Stripe platform application
(XC-039). Get legal review before relying on the wording.
