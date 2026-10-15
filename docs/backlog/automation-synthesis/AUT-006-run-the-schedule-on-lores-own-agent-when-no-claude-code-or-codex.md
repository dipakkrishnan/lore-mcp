---
id: AUT-006
title: Run the schedule on Lore's own agent when there is no Claude Code or Codex
priority: P1
effort: M
component: automation-synthesis
status: completed
related: [AUT-005, AUT-001, AUT-003, AUT-008, APP-200]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-13
updated: 2026-10-14
---

## Problem

The scheduled synthesis (`automation.task_for`) is installed only for a Claude
Code or Codex executor. A seller who has neither, which is the usual case for
non-developers, gets no recurring reading at all. Their connected apps are read
only when they connect an app or press Read again (AUT-005).

## Proposed approach

Add a third executor, "Lore", served by the desktop app. While Lore is open, a
timer at the profile's hour reads every connected app (`lore sources read`).
Anything new goes into AUT-005's quiet reading, so the notification, badge and
Today card stay the same. If Lore was closed at the scheduled hour, the next
launch catches up once. The onboarding rhythm question offers this executor
when neither command-line tool is installed.

## Acceptance criteria

- [x] A profile can name the app as its executor, and `schedule_state` reports
      it honestly, including when the app is closed.
- [x] A run that was due while Lore was closed happens once at the next launch.
- [x] New items from a scheduled read land as AUT-005's Today card and
      notification.

## Notes

This is not small, so it was left out of AUT-005. It needs a timer inside the
app, a way to catch up after Lore was closed, and a new executor in the
profile schema and in onboarding.

Oct 14: promoted to ready. It is the base for the evening check-in (AUT-008)
and the Automations tab (APP-200), which both need the app to run routines
itself.

Oct 14, done: `"executor": "lore"` in the profile. `lore profile` installs no
task for it and retires both agents' tasks. `automation.Routines` keeps
`~/.lore/automation/routines.json` (when each routine was first seen, last
run, result); `lore automation list|run --json` is all the app reads, so it
keeps no copy. A routine is due when its next hour after the last run (or
after it was first seen) has passed, so any number of missed hours is one
catch-up run. The app's `Schedule` (routines.cjs) runs what is due on launch
and on wake, then sleeps until the next hour, waking at least hourly. A run's
reads go through AUT-005's `readThrough`. `schedule_state` for Lore reports
`last_run` and `missed`. The app runs the schedule only when the profile
names Lore; with no profile nothing is scheduled, as before. Edge scenario:
`support/edge.sh schedule`.

Oct 14, review fixes: each kind of routine is one `automation.Routine` subclass
(`ReadApps` here) that owns its rhythm and its run; the CLI lists its `kind`
and the app's `AFTER_RUN` map does what that kind asks. Listing only reads.
`lore profile` writes the record (`Routines.adopt`), so a rhythm counts from
when it was saved and never runs at once. `Routines.save` re-reads
routines.json under an `fcntl` lock and changes only its own record, so a long
read no longer writes a stale copy over a change made meanwhile.
`install` for Lore calls `remove_all()` instead of building a throwaway task.
In the app, a profile saved with no executor on a Mac with neither `claude`
nor `codex` gets `lore`, and the onboarding skill sets it without asking.
