---
id: APP-100
title: Let the owner keep typing while Lore works
priority: P1
effort: M
component: desktop-app
status: ideation
related: [APP-069, APP-053, APP-099]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-07
updated: 2026-09-07
---

## Problem

While a turn runs, the composer greys out to "Lore is working…" in every
view, and other threads show "Lore is waiting on you in …". Dipak on the
final pass: "This whole 'Lore is working' thing that locks the whole app is
just odd and not pleasant." A turn can run for minutes; the owner has
nothing to do but watch, cannot queue the next thought, and cannot stop a
turn that is going the wrong way.

## Proposed approach

Keep the composer open during a turn. A message typed while Lore works is
either queued for the moment the turn ends or, when the owner asks, steers the
running turn (Pi's `session.steer`/follow-up queue). Show a Stop control next
to the live line. Other threads keep working independently; "waiting on you"
becomes a badge, not a lock.

## Acceptance criteria

- [ ] The composer accepts input while a turn runs, and the message lands
      when the turn ends or steers it.
- [ ] A running turn can be stopped from the thread.
- [ ] Views other than the running thread are never locked.
