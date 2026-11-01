---
id: MON-052
title: Don't sell a piece without a sample, and clean its public topic name
priority: P1
effort: S
component: monetization
status: in-review
related: [XC-093, XC-040]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-31
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

- [x] Approval can't finish without a sample; the app drafts one.
- [x] Every listed piece page shows a free sample and its length.
- [x] Public topic labels are owner-approved, sentence case, and never the private topic name.
- [ ] The existing listed pieces are backfilled.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.

What shipped (PR for MON-052):

- `Store.for_sale` is the one check: a sample of at least two sentences, and a
  topic of at most 40 characters that isn't the title or topic label of a memory
  the piece draws on; the topic is saved in sentence case. `lore publication
  draft` refuses a draft that fails it, so the publish agent always drafts a
  sample, and approval (the app's card, `lore publication review`) refuses too,
  with a plain line saying what to add. Drafts staged before this still show,
  so the owner can fix them on the card, where the topic is now editable.
- Free-parts updates (`set_extras`) can't leave a piece for sale without a sample.
- Collection pieces get their opening two sentences as a sample when that leaves
  most of the text to buy; dropping text in is already the owner's approval.
- The node sells only pieces with a sample (discover, `get`, store page, piece
  pages, checkout). A collection still sells every piece it holds; one without a
  sample shows on the collection page without a page of its own, and doesn't
  count toward what the pieces are worth separately. The catalog (discover and
  the store) groups pieces under a topic's name before any `:` or `;`, in
  sentence case, so older raw topics stop leaking detail. Catalog entries carry
  `words`, and piece pages show it.
- The publish skill now asks for a sample on every draft and a short public topic.

Backfill is left open: it is the owner's data. Pieces already for sale without a
sample drop off the store once the node is redeployed with this change, until
they have one. The fix is the existing free-parts flow: ask the publish agent to
add samples to the pieces for sale (`lore publication extras draft`), then
approve the cards in the app. Their raw topics read cleaner already through the
node's heading rule; renaming them needs a follow-up (no edit path for a live
piece's topic yet). The one-line seller bio from the proposed approach is not
in this change.
