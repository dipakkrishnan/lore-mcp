---
id: APP-084
title: Show the real schedule state under How often Lore reads them
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-073]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-05
updated: 2026-09-05
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

- [ ] With a profile but no installed schedule, the row does not say "Set".
- [ ] With an installed schedule, the row shows the cadence, not just "Set".

## Notes

Screenshot `28-dogfood-settings.png`. Related: the dogfood launcher sets
`LORE_SKIP_SCHEDULE=1` so the sandbox never installs one.
