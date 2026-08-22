---
id: APP-004
title: Guide first-run setup through the existing onboarding skill
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-003, APP-006, APP-007, ONB-003, AUT-001, XC-005]
blockers: [APP-003]
dependencies: []
github_issue: null
created: 2026-08-21
updated: 2026-08-22
---

## Problem

A new owner currently lands in the vendor console before Lore knows anything
about them. They need the existing onboarding conversation to import agent
context, collect corrections, establish a blueprint, and install synthesis
without requiring terminal knowledge or a second UI-owned workflow.

## Proposed approach

Invoke `lore-onboard` through the `AgentSession` kernel established by
`APP-003`. Pi keeps its native skills, read, and Bash capabilities; Lore keeps
only `ask_user` and the product prompt, and every Bash call remains subject to
the existing exact-command approval gate.

Render a short setup checklist from the versioned `APP-001` snapshot. The
skill's existing `$LORE_HOME/automation/onboarding.json` checkpoint and Lore's
validated CLI writes remain the durable truth. After restart, start a fresh Pi
session with the current snapshot and invoke the skill again; do not persist or
replay transcripts and do not add a UI-owned onboarding state machine.

## Acceptance criteria

- [ ] An owner with the Lore runtime available can start setup from Today and
      complete source import, blueprint confirmation, profile creation, and
      synthesis scheduling through the existing `lore-onboard` skill without
      typing terminal commands.
- [ ] Questions use `ask_user`; native Bash still shows the exact command and
      does not execute until the owner approves it.
- [ ] The checklist is derived only from `APP-001` setup fields and disappears
      once sources, blueprint, and profile are configured.
- [ ] Closing the app mid-setup and reopening it resumes from the skill's real
      checkpoint and current Lore state without replaying a transcript or
      repeating completed setup work.
- [ ] A temporary Lore home proves the renderer-to-Pi-to-skill-to-CLI path for
      a synthetic first-run setup.

## Notes

The skill remains the owner-journey source of truth. The app is its native
host, not a parallel wizard. Runtime provisioning stays in `APP-005`; owner
publication/payment actions and durable job history are split into `APP-006`
and `APP-007`.
