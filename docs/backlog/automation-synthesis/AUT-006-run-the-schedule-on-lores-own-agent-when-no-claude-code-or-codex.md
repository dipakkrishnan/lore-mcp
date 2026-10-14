---
id: AUT-006
title: Run the schedule on Lore's own agent when there is no Claude Code or Codex
priority: P2
effort: M
component: automation-synthesis
status: ideation
related: [AUT-005, AUT-001, AUT-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-13
updated: 2026-10-13
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

- [ ] A profile can name the app as its executor, and `schedule_state` reports
      it honestly, including when the app is closed.
- [ ] A run that was due while Lore was closed happens once at the next launch.
- [ ] New items from a scheduled read land as AUT-005's Today card and
      notification.

## Notes

This is not small, so it was left out of AUT-005. It needs a timer inside the
app, a way to catch up after Lore was closed, and a new executor in the
profile schema and in onboarding.
