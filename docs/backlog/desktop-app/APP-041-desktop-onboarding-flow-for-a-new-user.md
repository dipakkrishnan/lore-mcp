---
id: APP-041
title: Guide a new desktop user through an onboarding flow
priority: P2
effort: M
component: desktop-app
status: ideation
related: [ONB-001, ONB-003, APP-030, APP-036]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/176
created: 2026-09-01
updated: 2026-09-01
---

## Problem

The desktop app has no onboarding flow for a first-time user — someone who
opens it cold has no guided path into setup (store creation, skill
installation, Cloudflare/wallet setup per APP-036) or a first useful action.
Today's desktop console assumes the owner already has a working Lore
install; issue #176 asks for a real first-run experience inside the app
itself.

## Proposed approach

Unclear — needs investigation. `ONB-001`/`ONB-003` already own the
CLI/skill-side "bootstrap the Lore runtime" and "inject context via session
hooks" flows; `APP-030`/`APP-036` already chain setup steps once a store
exists. It's not yet decided whether this item is a genuinely new
first-launch screen inside Electron, or whether it's actually asking for
those existing flows to be surfaced/triggered from inside the desktop shell
rather than requiring a separate CLI bootstrap first. The GitHub issue is a
single sentence with no acceptance criteria, so the shape needs a follow-up
pass (or a prioritization/design read) before this is `in-review`.

## Acceptance criteria

- [ ] TBD — issue is not yet specific enough to state a concrete, checkable
      outcome. Needs a follow-up question to the issue author or a design
      pass before this can move to `in-review`.

## Notes

Cataloged from GitHub issue #176 ("Desktop app should support onboarding
flow"), whose entire body is "The desktop app should support onboarding flow
for a new user." Left in `ideation` per `agents/ideation.md` step 8 — no
concrete acceptance criterion could be written without inventing one that
isn't actually in the issue.
