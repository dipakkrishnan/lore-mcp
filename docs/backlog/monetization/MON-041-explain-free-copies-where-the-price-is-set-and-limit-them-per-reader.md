---
id: MON-041
title: Explain free copies where the price is set and limit them per reader
priority: P1
effort: S
component: monetization
status: in-review
related: [MON-040, APP-136, MON-035]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-11-12
---

## Problem

Free copies (MON-040) are on by default, but the seller never chose them and
nothing explains them. A seller who opens their own piece page sees Read free
and no Buy button, so the store looks broken. There is also no per-reader
limit, so one person or one script can use up every free copy.

## Proposed approach

- Next to the price: "Your first 3 readers per piece read free; Buy appears
  after." with a Change link. Consider defaulting to 1.
- Let the seller preview the page as a buyer sees it once the free copies are gone.
- Limit free copies to one per reader (by buyer identity or IP) on the node.

## Acceptance criteria

- [ ] The price row and the store-opening card both explain free copies
- [ ] The seller can see their page as a paying buyer would
- [ ] One reader cannot claim more than one free copy of a piece

## Notes

Filed from the 2026-10-06 new-seller audit. Without a per-reader limit,
sellers can lose sales once a store link is shared publicly.

**Delivery loop plan review (2026-11-12):** Moved back from `ready` to
`in-review`. Three implementation plans were written and each was
rejected by a plan reviewer that checked it against the code; the open
issues did not shrink between rounds, which suggests the item is
under-scoped as written. The reviewer's last open issues are below.
Labels such as "Test 2" or "R3" refer to that rejected plan, which
was not kept; the facts about the code stand on their own.

- AC3 is still narrowed even though the plan says it is not. The plan states
  'AC3 stays as written. Nothing is narrowed in Notes', but it also accepts
  that 'a reader could claim again 30 days later if copies remain'. That is
  one reader claiming two free copies of a piece, which AC3 ('One reader
  cannot claim more than one free copy of a piece') forbids. The 30-day TTL
  is the only thing that allows the second claim: a piece with copies left
  has no other purge trigger, because the takedown, exhausted and free-
  copies-off triggers all mean no further claim is possible. The fix is to
  pick one of two options. (a) Drop the time-based TTL. Retention is then
  bounded by exhaustion, takedown or free copies turned off, and PRIVACY.md
  says so. (b) Keep the TTL and state the narrowing of AC3 explicitly in
  Notes. As written, the plan claims (b) is not happening while doing it.
- The purge triggers reopen claims for readers already recorded, and the
  plan neither tests nor records this. Purge (a) deletes every reader row
  for a piece once COUNT(free sales) >= the current cap. Push deletes all
  rows when free_copies == 0. If the seller then raises the cap (for example
  3 to 5) or turns free copies back on, every earlier reader of a non-
  exhausted or newly reopened piece can claim a second copy. This is another
  AC3 gap. Either keep reader rows for an exhausted or switched-off piece
  until the piece is taken down (the cost is longer retention), or record it
  as a known limit next to the TTL. Today the plan lists neither.
