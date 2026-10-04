---
id: MON-036
title: Link listed stores to the marketplace and list them on request
priority: P1
effort: S
component: monetization
status: in-review
related: [XC-036]
blockers: []
dependencies: []
github_issue: 367
created: 2026-10-04
updated: 2026-10-04
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

- [ ] A listed node's store and piece pages link to the marketplace; an unlisted node's pages do not
- [ ] Submitting a listing request starts a refresh run without manual action
- [ ] The README's listing steps match `lore marketplace` and the registry workflow

## Notes

The badge follows the node's own switch, not `marketplace.json`, so it shows
while a request is pending and disappears on the push that delists.
