---
id: APP-084
title: Show the real schedule state under How often Lore reads them
priority: P2
effort: S
component: desktop-app
status: completed
related: [APP-073, APP-080, AUT-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-06
---

## Problem

Settings → "How often Lore reads them" shows "Set" whenever the profile is
configured (`renderer.js:633` reads `setup.profile_configured`). It does not
check that a synthesis schedule is installed. In the dogfood sandbox, which
skips schedule installation by design, the row says "Set" and the setup agent
promises "nightly synthesis will keep growing it with Claude each evening"
while nothing is scheduled. An owner whose launchd job failed to install would
see the same false "Set" (dogfood 2026-09-05).

## Proposed approach

Expose the installed schedule (or its absence) in the state snapshot and drive
this row from it. When the profile is set but no schedule exists, say so
("Not scheduled") and offer the fix.

## Acceptance criteria

- [x] With a profile but no installed schedule, the row does not say "Set".
- [x] With an installed schedule, the row shows the cadence, not just "Set".

## Notes

Screenshot `28-dogfood-settings.png`. Related: the dogfood launcher sets
`LORE_SKIP_SCHEDULE=1` so the sandbox never installs one.

Done 2026-09-06. `automation.schedule_state()` builds the task the profile
describes (`task_for`, split out of `install`) and asks the scheduler
whether it holds it (`windup.status`: launchd for Claude, the automations
file for Codex); `desktop-state` carries it as `setup.schedule`. Settings
reads it the way Codex's automations page does, in words: "Every day at
9 PM with Claude. Last ran Sep 5." with a Scheduled dot; a saved rhythm the
scheduler does not hold reads "Set for every day at 9 PM with Claude, but
nothing on this Mac is running it." with a **Schedule** button that runs
`lore profile` on the saved profile through a typed handler. The desktop's
CLI wrapper now prefers a `Reason:` line when a refusal is explained over
several lines, so the owner hears the cause rather than the retry command. The last-run sentence comes from the
synthesis rows Today already shows.

Known edge: launchd labels and the Codex automations file are per user,
not per Lore home, so a second home on the same Mac (the dogfood sandbox)
sees the owner's real schedule as installed. Truthful about the scheduler;
not about which home it serves.
