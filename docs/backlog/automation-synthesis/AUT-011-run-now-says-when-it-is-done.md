---
id: AUT-011
title: Run now says when it is done
priority: P1
effort: S
component: automation-synthesis
status: completed
related: [AUT-008, AUT-010, APP-200]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-15
updated: 2026-10-15
---

## Problem

Dipak pressed Run now on "Read connected apps" and couldn't tell when it
finished: "I just don't know when the automation finishes. Like presumably I
should get a notification when it's done." The run brought in 40 Claude Code
notes, yet its row said "Nothing new", because only connected apps were
counted. The evening check-in, by contrast, counted those notes as new
material, so it could ask the owner about an agent's notes to itself.

## Proposed approach

A run the owner starts is done once Lore's reading and check-in of what it
brought in are done. Lore says so in the app and, when the owner is in
another app, with one banner, unless the run already sent one saying what it
found. Runs on the clock stay quiet unless they find something.

## Acceptance criteria

- [x] While a run the owner started is going, its row reads "Running now…".
- [x] When it ends, Lore shows "“Read connected apps” is done · Nothing new"
      (or whatever the run found).
- [x] If the owner is away from Lore, a run that found nothing posts one
      banner with the same words. A run that found memories or asked a
      question posts only that banner.
- [x] The reading's result counts what came from Claude Code and Codex, e.g.
      "2 new meetings · 40 from Claude Code".
- [x] The evening check-in never asks about Claude Code or Codex notes.

## Notes

Oct 15, done:
- `LoreAgent.settled()` waits until no reading and no check-in is queued or
  running. The `routines:run` IPC awaits it and hands the routine back with
  its result.
- `CheckIn.run` passes the agent folders (`available_sources()`) to
  `Store.brought_in_after(skip=…)`.
