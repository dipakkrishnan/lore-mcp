---
id: APP-274
title: Tell a seller right away when a bid matches what they know
priority: P0
effort: L
component: desktop-app
status: in-review
related: [MON-051, CAP-036, XC-114, MON-056]
blockers: []
dependencies: [MON-051]
github_issue: null
created: 2026-10-31
updated: 2026-11-12
---

## Problem

A bid board only works if sellers see bids they can answer while the bids are still open. A
board waits for sellers to browse it. Lore has each seller's private memories on their own
Mac, so the app can do the matching for them.

## Proposed approach

The app reads `/bids.json` on the same schedule as its other polls and matches open bids
against the owner's memories **locally**, so nothing about the memories leaves the Mac. For a
strong match, it sends a notification and shows the red badge: "Someone will pay $10 for this
right now. You have 3 memories that answer it." Opening it shows a reply drafted from those
memories. The owner edits it and sends it, and it is listed as the answer piece.

## Acceptance criteria

- [ ] An open bid that a test library can clearly answer produces one notification with a drafted reply. An unrelated bid produces none.
- [ ] No memory text, title or id leaves the Mac until the owner sends an answer.
- [ ] Sending lists the answer piece at the bid amount in the bid's market, in under a minute.

## Notes

Oct 31: called the magic moment, and the proactive version of the check-in. Before this is
built, the matching happens by hand (MON-055).

Nov 1: P0. The engine is built: the app reads the board, `lore bids match` scores each open bid
against the kept memories on the Mac (contracts/bids.md, "Matching on the seller's Mac"), the
snapshot carries `bidMatches`, and `bids:draft` drafts the answer, with no tools and only the matched
memories, as a piece tied to the bid.
The Inbox (a later PR) shows them. Sending without the admin token is MON-056.

**Backlog audit (2026-11-12), moved to in-review:** Local matching, the
notification and drafting landed in PRs #633 and #642 and are tested.
Sending the answer to the bid is MON-056's work, which has not started, and
nothing has moved here since 2026-11-02. Back to in-review to move criterion
3 to MON-056, and to decide whether "drafted reply" means drafted on request
(as built) or ahead of time; then close.
