---
id: AUT-010
title: In the app, every routine runs on Lore
priority: P1
effort: S
component: automation-synthesis
status: completed
related: [AUT-006, AUT-009, AUT-004, APP-200]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-15
updated: 2026-10-15
---

## Problem

In the app, reading connected apps could still run on Claude Code or Codex.
Their scheduled task showed in Automations as "by Codex", was paused by
uninstalling it and resumed by reinstalling it, could run only every day or
every Monday, and had no Run now. The owner's own Mac was in that state: a
Codex task every Monday at 9 PM. Dipak: "If they use the app, why are Claude
Code / Codex part of this? Should just be the Lore path."

## Proposed approach

In the app, Lore runs every routine on its own scheduler. Claude Code and Codex
stay as sources: their memories are read as before, but they never run a
routine. When the app opens with a profile that names either agent, Lore takes
the reading over once.

## Acceptance criteria

- [x] On launch, a profile naming Claude Code or Codex has that agent's task
      removed, and its reading switches to Lore. The owner's cadence, hour,
      day and pause are kept. Nothing runs at once. This happens once, and is
      logged.
- [x] No runner choice and no agent name for scheduling anywhere in the app.
      Settings and Automations read "Every Sunday at 9 PM, while Lore is open".
- [x] Reading takes the same rhythms as other routines (daily, weekdays,
      weekly on any day), and has Run now.
- [x] The app's onboarding sets the rhythm with Lore as the runner, without
      asking who runs it.
- [x] The terminal flow (lore-onboard in Claude Code or Codex, no app) still
      installs the agent's task.

## Notes

Supersedes part of AUT-006: its third executor offered "when neither
command-line tool is installed" is now the only one in the app, and its
"the app runs the schedule only when the profile names Lore" is gone. Also
supersedes AUT-009's acceptance criterion "A profile naming Claude Code or
Codex keeps that agent reading".

Oct 15, done:
- `Routines.take_over()` does the move under the routines.json lock. It
  calls `remove_all()` (skipped under `LORE_SKIP_SCHEDULE`), sets the profile's
  `executor` to `lore` (which is what makes it run once), and restarts the
  reading's `since` at now. It appends one line to
  `automation/moved.log`. The CLI calls it before `automation` and
  `desktop-state` when `LORE_APP_VERSION` is set, so whichever the app asks
  first on launch does the move. A terminal `lore automation list` changes
  nothing.
- Codex's weekly day is Monday as windup installs it, and the owner could move
  it in Codex (Dipak's stayed on Monday). `codex_day()` reads `BYDAY` from
  the installed task so the move keeps that day. The profile now has a `day`
  (0 is Monday), and `cadence` accepts `weekdays`.
- Removed from the app path: `Routine.runner` and the runner field, the
  `schedule_state` scheduler query (`installed`, `executor`), pausing by
  uninstalling and reinstalling, the daily-or-weekly limit on reading,
  Run now only for Lore's routines, `RUNNERS`, the "Not scheduled /
  Schedule" Settings state and its `schedule:install` IPC, and the setup
  sandbox's write access to `~/.codex/automations` and
  `~/Library/LaunchAgents`.
- In the app, `lore profile` always saves `lore` and installs nothing. With
  `lore`, `install()` is no longer called, so it no longer removes anything.
- Kept for the terminal: `task_for`, `install`, `remove_all`,
  `schedule_failure`. These no longer touch the app path and cost no extra
  code there. AUT-004 (the terminal's weekly day) still applies to them.
