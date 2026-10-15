---
id: CAP-035
title: Read the day's calendar as context for the evening check-in
priority: P2
effort: M
component: capture
status: ideation
related: [AUT-008, CAP-009]
blockers: []
dependencies: [a calendar source Lore can read unattended]
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

The evening check-in (AUT-008) asks better questions when it knows the shape
of the day: who the owner met, and which meetings had no notes.

## Proposed approach

Read today's events (title, attendees, duration), but not as memories. They
only seed the check-in. The first option to try is macOS Calendar through
EventKit, which covers Google, iCloud and Exchange once they're added to
Calendar.app and needs one permission prompt. A hosted Google Calendar server
is the fallback.

## Acceptance criteria

- [ ] With permission granted, the check-in sees today's events. Without it,
      the check-in still works.
- [ ] Events are never stored as memories.
