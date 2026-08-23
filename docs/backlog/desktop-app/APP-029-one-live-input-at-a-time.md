---
id: APP-029
title: One live input at a time — the card or the composer, never both
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-016, APP-020, APP-028]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

While a question card is pending, the composer still shows "Reply to
Lore…" beneath it — a second text input that cannot work (the turn is
in-flight; a send would throw "Lore is already working"), competing with
the card's own "Or type your answer" (Dipak, 2026-08-23 dogfood). And
when a card arrives, the view scrolls to its bottom and focuses the last
free-text field, so a multi-question card is entered at the wrong end.

## Proposed approach

One input at a time. While `#request` is occupied, hide the composer (the
card is the input); while a turn is running with no card, show it
disabled with a working placeholder; only an idle thread shows the live
"Reply to Lore…". When a card arrives, scroll `#main` so the card's first
question sits at the top of the view, and focus nothing — the first
option is reachable by tab, and free text stays an opt-in.

## Acceptance criteria

- [ ] With a pending card there is exactly one visible text input: the
      card's; the composer is hidden.
- [ ] A new card is shown from its first question; no auto-focus into a
      free-text field; no scroll past the card.
- [ ] The composer returns, focused state intact, the moment the card is
      answered or the turn ends.
- [ ] Desktop typecheck and tests pass.
