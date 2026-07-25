---
id: DOC-001
title: Document the docs/backlog system in the top-level README
priority: P1
effort: XS
component: docs
status: completed
related: []
blockers: []
dependencies: []
created: 2026-07-25
updated: 2026-07-25
---

## Problem

`docs/backlog/` now holds a full backlog system (README, component folders,
management playbooks, skills, scheduled automations), but the top-level
`README.md` doesn't mention it anywhere. Anyone reading the README top to
bottom has no way to discover it exists.

## Proposed approach

Add a short section to `README.md` (near the "Guided onboarding" section)
pointing to `docs/backlog/README.md`, in a sentence or two — not a
duplication of its contents.

## Acceptance criteria

- [x] `README.md` has a short section linking to `docs/backlog/README.md`
- [x] The section states what the backlog is for in one sentence, not a
      restatement of its internals

## Notes

Filed while building the backlog system itself, as a seed item demonstrating
a small, unblocked, `ready` item.

Added a "Backlog" section to `README.md` right after "Guided onboarding",
linking to `docs/backlog/README.md`.
