---
id: APP-288
title: Give Bids a place in the sidebar
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-283, APP-274, APP-282]
blockers: []
dependencies: [APP-283]
github_issue: null
created: 2026-11-02
updated: 2026-11-02
---

## Problem

A bid reaches the owner only as an Inbox row once Lore matches it. There is nowhere to see the whole board, so the
owner can't tell what people are paying for or why nothing matched. The approved mock (shot `10-bids.png`) has a
Bids place; #641 lists it as a gap.

## Proposed approach

A sidebar item named **Bids**, between Inventory and Connectors (owner's naming, Nov 2: Inbox, Inventory, Bids,
Connectors). The page is one-line rows on hairlines: amount · question · market · time left (or a status pill such
as Paid) · match-strength glyph. Two text tabs: **Matches what I know** (the matches `BidWatch` already keeps) and
**All** (the board it already reads). Enter opens the bid page from APP-283; a bid with no match opens it with no
memory rows and no Draft button.

## Acceptance criteria

- [ ] The sidebar reads Inbox, Inventory, Bids, Connectors, and Bids shows the count of matches.
- [ ] Both tabs list from what the app already fetched; no extra request to yourlore.dev.
- [ ] Every row opens its bid page; ↑/↓ step through the list.
- [ ] Empty states: "No open bids" (All) and "Nothing on the board matches what you know yet" (Matches).
