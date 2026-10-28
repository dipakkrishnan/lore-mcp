---
id: MON-049
title: Don't sell a piece without a sample, and clean its public topic name
priority: P1
effort: S
component: monetization
status: ideation
related: [XC-093, XC-040]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

The piece a first user opened (`/p/23525c092236744db5685f81`) has no free sample, so the page is just a
title and a $1 button. Store headings show raw private topic names ("review interfaces thesis",
"Travel: window seat on United or American; beach trips chosen for diving and poke"). These are
inconsistently cased, and the last one gives the preference away for free.

## Proposed approach

At approval, require a sample of at least two sentences (draft one for the owner to edit), and a
short public topic label that's separate from the private topic name. Have the storefront
(`lore/node/src/storefront.ts`) show the label, the piece length, and a one-line seller bio when
one is set. Backfill the 25 listed pieces.

## Acceptance criteria

- [ ] Approval can't finish without a sample; the app drafts one.
- [ ] Every listed piece page shows a free sample and its length.
- [ ] Public topic labels are owner-approved, sentence case, and never the private topic name.
- [ ] The existing listed pieces are backfilled.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
