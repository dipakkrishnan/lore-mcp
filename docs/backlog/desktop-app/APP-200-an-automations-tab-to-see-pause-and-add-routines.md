---
id: APP-200
title: An Automations tab to see, pause and add routines
priority: P1
effort: M
component: desktop-app
status: completed
related: [AUT-006, AUT-008, AUT-002]
blockers: [AUT-006]
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

What Lore does on its own (reading connected apps, synthesis, and soon the
evening check-in) is invisible. The owner can't see what will run, when it last
ran, or what it found, and can't ask Lore to do something on a schedule
without a terminal.

## Proposed approach

A sidebar tab, "Automations", modelled on Codex's Scheduled list:

- One row per routine, with a plain name, when it runs, when it last ran and
  what it found ("Read Granola · every evening · 2 new meetings"). It has a
  switch to pause it and a menu with Run now, Change time and Remove.
- Lore's own routines come first: Read connected apps, Evening check-in
  (AUT-008), and Each Friday, suggest one piece worth selling. They are on by
  default where it makes sense and can't be deleted, only paused.
- "New automation" takes a plain sentence and a time ("Every Sunday, remember
  what I read this week"). The routine runs that sentence as a prompt on the
  app's agent, with the same rules as synthesis. It saves to private memory
  and never publishes.
- A blue dot on the tab when a routine finished with something unseen; the
  red dock badge stays reserved for things worth the owner's attention.

Routines live in `~/.lore/automation/routines.json`, owned by
`lore/automation.py` and listed through the CLI, so the app keeps no second
copy.

## Acceptance criteria

- [x] The tab lists every routine with its next run, last run and result.
- [x] Pause, Run now, Change time and Remove work and survive a restart.
- [x] An owner-written routine runs at its time and its output lands as
      private memories through the same sync as synthesis.
- [x] Lore's own routines can be paused but not removed.
- [x] Copy is plain words only (no cron, no "executor").

## Notes

The existing Claude Code/Codex scheduled synthesis shows as one row whose
runner is the owner's agent, so there aren't two places to manage scheduling.

Oct 14, done:
- Automations sits in the sidebar between Connectors and FAQ.
- Lore's own routines come first: Read connected apps (the profile's rhythm)
  and Evening check-in. The owner's own come after. Each row shows when it
  runs, the next date, when it last ran and what it found, a switch, and a ⋯
  menu (a native `<details>`) with Run now, Change time and Remove. Remove is
  only on the owner's own routines.
- All of it goes through `lore automation list|pause|resume|time|add|remove|run`
  on `~/.lore/automation/routines.json`. The app keeps no copy.
- Pausing or retiming the reading routine when Claude Code or Codex runs it
  takes their task down or reinstalls it through the profile. Its rhythm is
  every day or every week (Mondays), because that is all those agents
  schedule. Run now is offered only on routines Lore runs.
- An owner's routine runs its sentence as a quiet `lore-synthesize` turn, so
  it follows the same rules and the same memory sync. It lands on Today and as
  a notification like any reading, and is never published.
- The blue dot comes from each routine's `found` flag and a per-Mac "last
  looked" time kept in localStorage.
- Not built: "Each Friday, suggest one piece worth selling" as a third
  built-in. It needs its own output shape (a draft offer, not memories), so it
  is a follow-up. An owner can add it as their own sentence today.
- Edge walk: `support/edge.sh automations`.
