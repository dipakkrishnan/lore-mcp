---
id: APP-109
title: Make every empty state name the next action and link to it
priority: P3
effort: XS
component: desktop-app
status: completed
related: [APP-092, APP-094, APP-081, APP-107]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-12
updated: 2026-09-12
---

## Problem

A fresh Lore shows "Nothing kept yet." on Memories and stops. For Sale says
"Nothing for sale yet. Publish something from Today." and "No sales yet.",
which name a place but give nothing to click. The owner reads the sentence,
then has to find the tab and the control on their own.

Obsidian's empty tab (walked 2026-09-11) is three links with their shortcuts:
"Create new note (⌘N)", "Go to file (⌘O)", "Close". Nothing to read, only
things to do, and each one teaches the key that does it next time.

## Proposed approach

Rewrite each empty state as one sentence plus one action that goes there:

- **Memories, none kept:** "Nothing kept yet. Say what you learned and Lore
  will keep it." with a "Capture something" link that switches to Today and
  focuses the composer. Mention ⌘K once `APP-107` lands.
- **For Sale, no store:** keep the existing card, and make "Open one from
  Today" a link that starts the store task rather than a sentence.
- **For Sale, nothing published:** "Nothing for sale yet." with a "Draft one
  from a memory" link that opens Memories.
- **Sales, none:** leave as is; there is no owner action that produces a
  sale.
- **Today, no recent runs:** "Nothing has run yet." is fine; the Needs You
  card above it already carries the action.

Same surface style as the hover notes from `APP-092`, no system-blue links.

## Acceptance criteria

- [x] Each empty state on Memories and For Sale contains exactly one action that performs or navigates to the next step, and clicking it does so.
- [x] Each action is reachable by keyboard and reads as an action, not body text.
- [x] Copy uses the same plain words as `APP-094` ("kept", "for sale", "store"), no plumbing terms.

## Notes

Filed 2026-09-12 from an operated comparison of Obsidian 1.13's empty tab
against the rendered Lore views (`app/desktop/support/screenshot.cjs` on a
fresh `LORE_HOME`).

Completed 2026-09-12. The Memories action reads "Add your first memory", not
"Capture something": the header beside it already says "+ Add Memory", and one
action should not wear two names on the same screen. Memories, For Sale's bar without a store, and For Sale
with nothing published each carry one action; Sales and Today's runs are left
as they were. The actions use the same quiet accent buttons as row actions, and
the store-bar link is an inline button in the sentence. ⌘K is not mentioned in
the copy: the sidebar field already shows it. Verified by the new `fresh`
persona in `support/edge.cjs`, which runs against an unseeded home.
