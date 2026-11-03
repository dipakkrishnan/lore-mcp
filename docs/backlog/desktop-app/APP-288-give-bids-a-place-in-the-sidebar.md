---
id: APP-288
title: Give Bids a place in the sidebar
priority: P1
effort: M
component: desktop-app
status: completed
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

- [x] The sidebar reads Inbox, Inventory, Bids, Connectors, and Bids shows the count of matches.
- [x] Automations is a section of Connectors, not a sidebar place; New automation stays in the New menu.
- [x] Both tabs list from what the app already fetched; no extra request to yourlore.dev.
- [x] Every row opens its bid page; ↑/↓ step through the list.
- [x] Empty states: "No open bids" (All) and "Nothing on the board matches what you know yet" (Matches).

## Notes

- The bid page's line under the question no longer repeats the amount and time left; both are in the properties.

- `BidWatch` kept only the matches, so each look now also keeps the board it read, trimmed to what a row shows (id,
  question, amount, market, link, close date), in the same `bid-matches.json`, still bounded by `BOARD_BYTES` and
  `BIDS_AT_MOST`. `board()` reads it back less the dismissed and the closed. No new fetch: the snapshot reads the file.
- All lists the board in its own order, then any match the last look didn't list. Matches lists best first.
- A row shows a pill in place of its time left while the owner's answer is under way: Drafting, Answer drafted,
  Answer ready. There is no "Paid" yet: nothing tells the app a bid was paid until MON-056 sends answers.
- A bid page opened from Bids has Bids as its breadcrumb, steps through the tab it came from, and Esc goes back there.
- Automations left the sidebar (owner's call, Nov 2, matching the mock). Every automation now sits in an
  **Automations** section at the foot of Connectors, one line each; new ones start from the New menu (⌘N, A), as
  everything else does. A connected app's sheet says when Lore next reads it ("every day at 9 AM"), the time a link to
  the reading schedule. Lore keeps one reading schedule for all apps, so it is not per connector as in the mock. The
  evening check-in, Suggest collections and the owner's own automations have no connector, so they sit in the same
  section. Anything that still asks for Automations (the Mac notification after Run now, the Today notice) lands there.
- Design gap: markets show as their slug in words ("Rl evals"), as the bid page already did, because the app has no
  market names. The mock's "AI research" needs the registry's names on the board or in the app.
