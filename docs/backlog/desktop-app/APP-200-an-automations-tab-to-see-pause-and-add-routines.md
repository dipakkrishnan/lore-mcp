---
id: APP-200
title: An Automations tab to see, pause and add routines
priority: P1
effort: M
component: desktop-app
status: ready
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

- [ ] The tab lists every routine with its next run, last run and result.
- [ ] Pause, Run now, Change time and Remove work and survive a restart.
- [ ] An owner-written routine runs at its time and its output lands as
      private memories through the same sync as synthesis.
- [ ] Lore's own routines can be paused but not removed.
- [ ] Copy is plain words only (no cron, no "executor").

## Notes

The existing Claude Code/Codex scheduled synthesis shows as one row whose
runner is the owner's agent, so there aren't two places to manage scheduling.
