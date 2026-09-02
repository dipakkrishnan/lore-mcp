---
id: APP-049
title: Show setup progress as a step count or percent, not just "Setting up"
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-022]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

While a new owner's Lore is being set up, the sidebar account chip
(`src/renderer.js:568`) just shows the static label "Setting up" for the
whole duration — the store label falls back to that string whenever
`nodeLabel(snapshot.node.live.state) === "Not set up"`. There's no sense of
how far along setup is or how much is left, even though the setup task
already tracks a named `phase` string as it progresses (see
`TASKS.setup.phase` and `#record`/`appendTaskRecord` in `src/agent.mjs`).
An owner watching "Setting up" with no further signal can't tell whether
it's about to finish or stuck.

## Proposed approach

Unclear on the exact display — needs a design decision, not just plumbing.
Two directions, not mutually exclusive:
- Surface the existing per-task `phase` string (e.g. "Shape your Lore")
  instead of the generic "Setting up", so the label at least says what's
  happening.
- Add an actual step count or percentage if setup can be broken into a
  fixed, known sequence of stages — would need the setup task's stages
  enumerated somewhere stable enough to count against (currently `phase` is
  a free-text string set ad hoc via `#record`, not drawn from a fixed list).

## Acceptance criteria

- [ ] The sidebar account chip shows more than the static word "Setting up"
      while setup is in progress — at minimum the current phase name, ideally
      a step count or percent (e.g. "Setting up · 6/10" or "Setting up 60%").
- [ ] The indicator advances visibly as setup moves through its stages,
      verified by an owner watching a real `dogfood:new` first-run pass.

## Notes

Reported by the owner while dogfooding (2026-09-02), with a screenshot of
the sidebar chip reading "Claude · Setting up" for the whole setup task with
no further progress indication.
