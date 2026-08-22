---
id: APP-004
title: Guide first-run setup through the existing onboarding skill
priority: P1
effort: M
component: desktop-app
status: completed
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

- [x] An owner with the Lore runtime available can start setup from Today and
      complete source import, blueprint confirmation, profile creation, and
      synthesis scheduling through the existing `lore-onboard` skill without
      typing terminal commands.
- [x] Questions use `ask_user`; native Bash still shows the exact command and
      does not execute until the owner approves it.
- [x] The checklist is derived only from `APP-001` setup fields and disappears
      once sources, blueprint, and profile are configured.
- [x] Closing the app mid-setup and reopening it resumes from the skill's real
      checkpoint and current Lore state without replaying a transcript or
      repeating completed setup work.
- [x] A temporary Lore home proves the renderer-to-Pi-to-skill-to-CLI path for
      a synthetic first-run setup.

## Notes

Done on `claude/app-004-onboarding`. The bash policy is one table in
`app/desktop/src/agent.mjs`: the skill's read-only commands (`lore status`,
`lore blueprint show`, the four `ls` evidence lines, `which claude codex`) run
silently; the checkpoint is allowed only as one exact `cat > … <<'LORE_CHECKPOINT'`
heredoc whose body must parse as a JSON object; `lore setup --yes`,
`lore blueprint apply - <<'LORE_BLUEPRINT'`, and `lore profile - <<'LORE_PROFILE'`
ask once as cards that show the parsed fields. The skill now persists through those
stdin heredocs in every host (`lore blueprint apply -` learned stdin), so the
`mktemp` path is gone. Resume after restart is the skill's own checkpoint plus the
snapshot flags, which also drive the Today step header.

Proof in a temporary `LORE_HOME`/`CLAUDE_HOME`/`CODEX_HOME`: the real app rendered
Start, the step header, and every approval card; Pi's real bash tool behind the
policy executed the skill's exact command sequence and flipped the snapshot flags
sources → blueprint → profile, with the Codex schedule landing only in the temporary
`CODEX_HOME`. The model turn itself did not run: no provider credential was stored
under the app's userData at the time, so the skill's commands were issued by the
proof script rather than by a live model reading the skill.

Approval cards show what a write means rather than its text (the APP-003 face
decision); the exact command still travels in the event and renders verbatim for
anything the table does not parse.

The checkpoint file lands with the shell's default mode (0644), unlike the 0600
profile; the skill wrote it the same way before. Tightening that is a CLI change.

The skill remains the owner-journey source of truth. The app is its native
host, not a parallel wizard. Runtime provisioning stays in `APP-005`; owner
publication/payment actions and durable job history are split into `APP-006`
and `APP-007`.
