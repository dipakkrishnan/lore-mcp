---
id: AUT-009
title: Lore's own routines are on from the start
priority: P1
effort: S
component: automation-synthesis
status: completed
related: [AUT-006, AUT-008, APP-200]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-15
---

## Problem

Reading connected apps on a schedule ran only once a saved profile named who
reads, and the profile is saved only in the guided setup, which the app offers
only when Claude Code or Codex memories are on the Mac. An owner with neither,
like Zane, never got one: their apps were never read again on their own, and
the evening check-in was listed paused.

## Proposed approach

Every one of Lore's own routines is on until the owner pauses it. With no
profile, or one that names no agent, Lore reads. The check-in reads nothing
itself, so it is on whoever reads. "On" is the absence of a pause, never a
write over one, and a routine first kept by default counts from that moment.
The app says so once.

## Acceptance criteria

- [x] No profile, or no agent named: Read connected apps is on with Lore,
      every day at 9 AM, and the Evening check-in is on, weekdays at 6 PM.
- [x] A profile naming Claude Code or Codex keeps that agent reading; the
      check-in is on.
- [x] A pause or a time the owner set, including one kept in routines.json by
      an earlier build, stays.
- [x] Upgrading runs nothing at once: a routine first kept by default waits
      for its next hour.
- [x] The first launch says, once, what Lore does on its own, with an
      Automations button; the next launch says nothing.
- [x] Settings and Automations describe it as it runs.

## Notes

Oct 14, done:
- `ReadApps.runner` is the profile's agent or Lore; with Lore and no saved
  hour it reads at 9 AM rather than an agent's 9 PM, so the app is likely open
  and the 6 PM check-in has the day's items. `CheckIn` no longer overrides
  `paused`; `Saved.paused` is only ever the owner's.
- `Routines.list()` calls `begin()`, which sets up any of Lore's own with no
  record yet through the kind's `set_up()` (`since` now; the check-in also
  takes its `mark`). Records already kept are left alone, pause and all.
  Routines were not in a release before this, so released installs have no
  routines.json and upgrade through the same path.
- `schedule_state()` no longer returns None with no profile; it reports Lore.
- The notice is remembered as the `automations_noticed` setting, the way
  `telemetry_noticed` is (`lore automation noticed`). A notice that carries an
  action now stays until dismissed rather than being replaced by the next
  success, so it and the usage notice can both show on a first launch.
- `lore profile` with an empty executor still reports that no agent schedule
  was installed, though Lore now reads for it; the guided setup always names
  one.

Oct 15: AUT-010 supersedes "A profile naming Claude Code or Codex keeps that
agent reading". In the app, Lore takes that reading over on launch.
