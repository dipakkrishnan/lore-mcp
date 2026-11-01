---
id: APP-232
title: Ask the store within seconds while an app waits to sign in or Lore is on screen
priority: P1
effort: S
component: desktop-app
status: in-review
related: [APP-207, XC-068]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-20
updated: 2026-10-20
---

## Problem

The Mac asked the owner's store what was waiting once a minute. An agent's sign-in page polls every 2 seconds, but the request to allow it could sit for up to a minute before Lore showed it. Saves from the owner's agents waited just as long. During that time nothing told the owner what was happening.

## Proposed approach

One check is a short read of the store, about a second. Instead of a fixed timer, the watch sets the time to its next check after each one:

- every 3 seconds while an app is waiting to sign in;
- every 10 seconds while Lore is on screen;
- once a minute while it is out of sight.

Coming back to Lore still checks at once.

## Acceptance criteria

- [x] A sign-in request appears in Lore within seconds, on screen or not
- [x] Saves land within about 10 seconds while Lore is on screen
- [x] Out of sight, Lore still checks only once a minute
- [x] A failed check keeps the last answer's pace

## Notes

A follow-up could show "Checking for saves from your agents" with the time of the last check, so a wait is never silent.
