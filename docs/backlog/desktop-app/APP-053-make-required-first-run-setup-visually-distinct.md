---
id: APP-053
title: Make required first-run setup visually distinct from optional next steps
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-049]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

`needsYou()` (`src/renderer.js:322-341`) renders the Today screen's "Needs
You" list as a strict `if`/`else if` chain: while setup is incomplete, it
shows exactly one row at a time ("Connect your agents", then "Shape your
Lore", then "Set the rhythm") using the same row style, same 8px `.dot`
indicator (`var(--attention)`, `src/styles.css:254`), and the same small
secondary "Start" button as the fully optional rows that appear once setup
is done ("Open your store", "Publish something"). A first-time owner who
hasn't set up their account yet sees a single unlabeled checklist row that
looks identical in weight to an optional suggestion — nothing marks it as
"you need to do this before the app is useful," so it's easy to read past
and not realize clicking Start begins required setup rather than an
optional extra.

## Proposed approach

Unclear on exact treatment — needs a design decision. Candidate directions:
- Give the required-setup state (before `blueprint_configured` /
  `profile_configured`) a visually distinct card/banner treatment on Today,
  separate from the "Needs You" list of optional next actions.
- Or keep it in the same list but give incomplete-setup rows a stronger
  visual signal (different dot color/size, a "required" label, bolder
  button) than post-setup optional rows.
- Consider whether the empty "0 memories, only on this Mac / 0 for sale /
  Store not set up" footer row (visible in the same screenshot) could
  reinforce, rather than compete with, whatever signal is added above.

## Acceptance criteria

- [ ] A first-time owner looking at Today can tell, without prior knowledge
      of the app, that they need to complete setup (at least the blueprint
      step) before the rest of the app is meaningful.
- [ ] The required-setup state reads as visually distinct from the optional
      "Open your store" / "Publish something" rows that appear later.

## Notes

Reported by the owner while dogfooding (2026-09-02), last in a series of
five UI/UX reports from the same session (APP-049 through APP-053).
