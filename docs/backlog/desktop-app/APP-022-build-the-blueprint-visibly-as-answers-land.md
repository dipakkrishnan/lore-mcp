---
id: APP-022
title: Build the blueprint visibly as answers land, instead of a history of replies
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-020, APP-021, APP-009]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

During onboarding the thread shows a history of the owner's answers as
"You" lines, but the thing being made — the blueprint, then the profile —
is invisible until the final card. Dipak (2026-08-23): "it'd be really
cool if you could see the agent almost cobbling together the profile and
blueprint AS we go... a 'smart' blueprint being built in an animated, fun
way."

## Proposed approach

A persistent blueprint panel beside or above the thread during setup: the
same fields as the propose_blueprint card (name, told-as, topics, depth,
voice), starting as ghost placeholders and filling in with a small
animation as each answer or evidence pass lands. The kernel already emits
typed events at each step (`task` records, ask_user answers,
propose_blueprint payload); the panel derives from those — no new model
output format. The final card then reads as "confirm what you watched get
built" rather than a wall of fields.

## Acceptance criteria

- [ ] During setup, a blueprint panel shows fields filling as answers land,
      with a subtle animation (reduced-motion respected).
- [ ] The panel derives only from typed events already emitted; no prose
      parsing.
- [ ] The final approval card visually matches the panel the owner watched.

## Notes

Filed from mid-dogfood feedback. Pairs with the brevity rule from APP-021 —
the panel carries the state so messages can stay short.
