---
id: APP-068
title: Preselect and tag the recommended answer on a question card
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-052, APP-022]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-10-19
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

- [x] A single-choice question opens with the model's recommended option
      selected and tagged Recommended; Continue with no clicks submits it.
- [x] Multi-select questions are unchanged.

## Notes
Reviewed 2026-09-04: the first option is not necessarily the recommendation,
so the model marks the recommendation explicitly rather than encoding it in a
label or position.

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in 4327730, a123ac0. Closed out in the review-queue pass.
