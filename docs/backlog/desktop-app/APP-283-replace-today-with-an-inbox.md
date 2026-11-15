---
id: APP-283
title: Replace Today with an Inbox
priority: P1
effort: L
component: desktop-app
status: completed
related: [APP-281, APP-214, APP-219, APP-274, APP-284, MON-056]
blockers: []
dependencies: [APP-281, APP-274]
github_issue: null
created: 2026-11-02
updated: 2026-11-12
---

## Problem

Today is a date eyebrow, a greeting and a capture hero, then up to eight kinds of card. Principles §6 ask for an
Inbox: one row type, one verb each, and "You're all caught up" when empty. A bid that matches what the owner knows
(APP-274) has nowhere to land but a Mac notification.

## Proposed approach

The home view is the Inbox: one row per thing that needs the owner (a bid that matches, a draft, a check-in, a sale,
a connector that stopped, the next step, an unfinished thread, new memories, a suggested collection), each a glyph,
one sentence, an age and one verb, with Done on hover or E. Capture moves to New › Memory and ⌘K. The rows are worked
out in `app/desktop/src/inbox.js`, which `test/inbox.test.cjs` checks without a window.

A bid opens as its own page (principles §5): the question, the memories Lore found (marked "Not sent to buyer"),
Draft the answer, the editable draft, Approve through the existing approval path, Dismiss; properties in a right
column and an Activity timeline; ↑/↓ step through the Inbox's bids. Sending the answer to the buyer is MON-056, so
an approved answer says "Your answer is ready. Sending it to the buyer comes next."

The owner named the sidebar places on Nov 2: Inbox, Inventory, Bids, Connectors. The Bids place is APP-288.

## Acceptance criteria

- [x] The home view is one list of rows, each with one verb; empty says "You're all caught up".
- [x] The sidebar names it Inbox, with a count.
- [x] A matching bid is an Inbox row and opens as a page with its states: no match, matched, drafting, drafted,
      approved, dismissed, closed.
- [x] A bid notification opens that bid (several open the Inbox).
- [x] The first-run chat opens with "Hi, I'm Lore. I keep what you teach your AIs here on this Mac, so every one of
      them can use it."

## Notes

**Backlog audit (2026-11-12), closed as completed:** PR #641 merged on
2026-11-03 and every criterion holds on main: inbox.js has the row and bid-
state logic (test/unit/inbox.test.cjs passes), the sidebar Inbox has a
count, a single-bid notification opens that bid in main.cjs, and the first-
run line is in renderer.js. It sat at in-review only because the PR was
opened as a draft for owner review, so it moves to completed.
