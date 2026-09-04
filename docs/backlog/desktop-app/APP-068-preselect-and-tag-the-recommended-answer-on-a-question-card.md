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

In the question card (`renderer.js:841`), preselect the first option of every
single-choice question and render a small "Recommended" chip on it. No tool
schema change: the convention that the first option is the recommendation is
already what the skills produce. If a question must not carry a default, the
agent can say so in the option text.

## Acceptance criteria

- [ ] A single-choice question opens with its first option selected and
      tagged Recommended; Continue with no clicks submits it.
- [ ] Multi-select questions are unchanged.

## Notes

