---
id: APP-068
title: Preselect and tag the recommended answer on a question card
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-052, APP-022]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

The onboarding interview asks several single-choice questions per card, and
the agent already has a recommendation ("Looks right", "$0.01"). Nothing in
the card marks it, and nothing is selected, so a
non-technical owner reads every option before they can press Continue. The
owner asked for a recommended option they can just click (dogfood 2026-09-04).

## Proposed approach

Let the model mark an option with a `recommended` boolean. Preselect and tag
only that option. Do not infer a recommendation from label text or position,
because questions like "Do you already have a wallet?" have no recommendation.

## Acceptance criteria

- [ ] A single-choice question opens with the model's recommended option
      selected and tagged Recommended; Continue with no clicks submits it.
- [ ] Multi-select questions are unchanged.

## Notes
Reviewed 2026-09-04: the first option is not necessarily the recommendation,
so the model marks the recommendation explicitly rather than encoding it in a
label or position.
