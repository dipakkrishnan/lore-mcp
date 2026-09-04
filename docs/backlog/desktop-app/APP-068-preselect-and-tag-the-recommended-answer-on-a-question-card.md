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
the agent already leads each with its recommendation ("Looks right", "$0.01
(Recommended)"). Nothing in the card marks it, and nothing is selected, so a
non-technical owner reads every option before they can press Continue. The
owner asked for a recommended option they can just click (dogfood 2026-09-04).

## Proposed approach

Preselect only an option whose label ends in "(Recommended)", and render that
suffix as a chip instead of text. Add one clause to the desktop system prompt:
mark your recommendation "(Recommended)" when you have one. No schema change
and no automatic first-option default, because questions like "Do you already
have a wallet?" have no recommendation.

## Acceptance criteria

- [ ] A single-choice question opens with its first option selected and
      tagged Recommended; Continue with no clicks submits it.
- [ ] Multi-select questions are unchanged.

## Notes
Reviewed 2026-09-04: the first option is not the recommendation in the wallet questions, so preselecting it would answer for the owner.
