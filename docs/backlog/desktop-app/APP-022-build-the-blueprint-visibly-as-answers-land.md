---
id: APP-022
title: Build the blueprint visibly during the evidence scan
priority: P2
effort: M
component: desktop-app
status: ready
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

Animate the *evidence scan*, not a replay of the owner's answers: with
propose-first onboarding there are only one or two cards, so the show
happens while Lore reads the agents' memories. A ghost blueprint panel
(name, told-as, topics, depth, voice) sits above the thread; as the scan
progresses, topics pop in one by one ("lore-mcp… deep-review… learner"),
depth markers appear, and the owner watches the guess form before being
asked anything. The panel derives only from typed events the kernel
already emits (task records, tool progress, the propose_blueprint
payload) — no prose parsing, no new model output format. The final
approval card is the same panel switched to confirm mode, so there is one
component and one source of truth. Motion stays restrained: fields settle
into place; nothing celebratory; reduced-motion respected.

## Acceptance criteria

- [ ] During the evidence scan, the ghost panel fills field by field from
      typed events; the owner sees the proposal form before any question.
- [ ] The approval card is the panel in confirm mode — one component.
- [ ] No prose parsing; reduced-motion honored; nothing animates after the
      panel is settled.

## Notes

Filed from mid-dogfood feedback, rescoped 2026-08-23 after review: the
original "animate as answers land" framing had little to animate under
propose-first onboarding. This is also the strongest launch-demo moment —
an agent visibly assembling your professional shape from your own history.
Pairs with APP-021's brevity rule: the panel carries state so messages
stay short.
