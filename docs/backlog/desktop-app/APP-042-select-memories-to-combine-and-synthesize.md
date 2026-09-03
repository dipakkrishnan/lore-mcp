---
id: APP-042
title: Let a desktop owner select memories to combine and synthesize
priority: P2
effort: M
component: desktop-app
status: ideation
related: [AUT-002, APP-014, APP-011]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/173
created: 2026-09-01
updated: 2026-09-01
---

## Problem

Synthesis (`AUT-002`) today runs as a scheduled pass over recent sessions,
net-new-claims-driven, not owner-directed. Issue #173 asks for the reverse:
letting an owner pick a specific set of already-captured memories in the
desktop app and trigger a synthesis over just that selection. There's no
multi-select affordance on the memories list today, and no manual synthesis
trigger surfaced anywhere in the desktop shell.

## Proposed approach

Unclear — needs investigation. This spans two components: a UI piece
(multi-select on the memories list, an action to invoke) that's desktop-app,
and a synthesis-engine piece (does `AUT-002`'s pipeline accept an explicit
memory-ID set as input today, or does it only run against "recent
sessions"?) that's automation-synthesis. The issue is one sentence with no
acceptance criteria and doesn't say what "combine and synthesize" should
produce (a new memory? an edited existing one? a draft for approval per
`APP-033`?) — that's a real design question, not an implementation detail.

## Acceptance criteria

- [ ] TBD — issue doesn't specify the output shape (new memory vs. edit vs.
      approval draft) or whether the synthesis engine already supports an
      explicit-selection input. Needs a design/prioritization pass before
      `in-review`.

## Notes

Cataloged from GitHub issue #173 ("Desktop users should be able to select
memories to combine and synthesize"), whose entire body is "As a desktop
user, I want to be able to selecta few memories that I can combine and
synthesize." Left in `ideation` per `agents/ideation.md` step 8 — no
concrete acceptance criterion could be written without inventing the output
shape, which the issue doesn't specify.
