---
id: APP-235
title: Offer Draft for sale only where it makes sense, say why before asking, and fit the approval cards
priority: P1
effort: S
component: desktop-app
status: in-review
related: [AUT-005, APP-213]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-21
updated: 2026-10-21
---

## Problem

On Oct 21 the owner chose Draft for sale on a memory of their travel preferences: window seat, United or American, diving and poke. The reading had already judged it not worth selling. Three things went wrong:

- **The sheet offered it anyway.** A memory's sheet always shows Draft for sale, and so does every Inventory row. Today's new memories show it only where the reading judged the memory worth selling. That judgement was kept only with Today's last five runs, so nothing else could use it.
- **The publish agent asked without saying why.** It read the memory and asked "What should we do instead?", recommending another topic. It never said it thought the memory was too weak to sell. The owner found the question baffling.
- **The approval card was hard to handle.** Every draft was a card inside the section's own card. A long topic ran out of the card. Approve and Skip sat below the whole draft.

## Proposed approach

- Keep what each reading judged with the memory in the store (`memory_verdicts`, written with `lore memory judge -` once a reading lands). The sheet and Inventory read it from there. A memory judged not worth selling says why in one quiet line instead, with "Draft anyway" beside it. Work memories are never offered for sale. A memory no reading judged keeps Draft for sale as before.
- "Draft anyway" tells the publish agent the owner already knows. The skill says why in one plain sentence before it offers options, and never asks a question whose premise the owner hasn't been told.
- Each draft is one card on its own, as Today's other cards are. Its title shares the top row with Preview, Edit, Skip and Approve. The topic chip is cut short with an ellipsis, and the full topic shows on hover.

## Acceptance criteria

- [ ] A memory judged not worth selling shows no Draft for sale on its sheet or its Inventory row. Its sheet says "Private · <why>" and offers "Draft anyway". A work memory says "Work · stays private" and offers neither.
- [ ] A memory judged worth selling, or not judged at all, still shows Draft for sale.
- [ ] Deleting a memory removes what was judged of it. A later reading replaces the old judgement.
- [ ] The lore-publish skill says why before it asks about a weak memory, and drafts when the owner asks for it anyway.
- [ ] Approve what to sell shows each draft as one card, with Approve and Skip in its top row. A long topic stays inside the card.
