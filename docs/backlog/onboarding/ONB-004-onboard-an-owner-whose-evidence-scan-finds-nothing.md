---
id: ONB-004
title: Onboard an owner whose evidence scan finds nothing
priority: P2
effort: M
component: onboarding
status: in-review
related: [APP-041, APP-048, APP-053]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

"Connect your agents" reads Claude Code and Codex history and proposes a
shape from it. The dogfood sandbox keeps the owner's real home, so every pass
sees months of history. A stranger from the launch post may have neither
tool installed, and the edge audit's finding 15 (an empty-evidence branch)
was deferred at the freeze and never filed. What the app says when the scan
finds nothing is untested.

## Proposed approach

Unclear until observed. Run `dogfood:new` with the history paths pointed at
empty directories and record what happens. Likely shape: the skill's
interview asks the owner to tell Lore about themselves in three questions
and proposes a shape from the answers, with the memory count honest at zero.

## Acceptance criteria

- [ ] With no Claude or Codex history, setup completes and the owner reaches
      capture without an error or an empty proposal.
- [ ] The first-run rails still read as a path when the memory count is zero.

## Notes

From the 2026-09-04 dogfood plan audit; the Sep 2 triage listed it under
"an alpha can carry them".
