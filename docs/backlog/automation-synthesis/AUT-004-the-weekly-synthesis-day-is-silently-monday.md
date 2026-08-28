---
id: AUT-004
title: The weekly synthesis day is silently Monday, whatever the owner was told
priority: P1
effort: S
component: automation-synthesis
status: ready
related: [AUT-001, AUT-002, APP-030]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-24
updated: 2026-08-26
---

## Problem

The profile schedule captures cadence and hour but no weekday;
`_rrule()` hardcodes `FREQ=WEEKLY;BYDAY=MO`. During desktop onboarding
(2026-08-23) Dipak chose "Codex weekly Sunday at 9 PM" and the model
confirmed "Sundays at 9 PM" twice — but the installed automation said
Monday, so the promised first run silently never happened. AUT-001's
notes already flag the missing knob; onboarding now makes promises
against it.

## Proposed approach

Add `weekday` to the profile schema (optional; default = the install
day, not a hardcoded Monday), thread it through `lore profile`
validation, `_rrule()`, and the launchd/Codex writers, and include the
day in the scheduling question's options so the model can only promise
what the profile can express. Backfill: regenerating from an existing
profile without a weekday keeps current behavior.

## Acceptance criteria

- [ ] The profile stores an explicit weekday for weekly cadence; `lore
      profile` validates it.
- [ ] `_rrule()` and the launchd path derive the day from the profile;
      no hardcoded Monday.
- [ ] The onboarding scheduling exchange offers the day, and the
      confirmation echoes exactly what was installed.
- [ ] Tests cover a weekly Sunday profile end to end.

## Notes

Dipak's installed automation was hand-corrected to `BYDAY=SU` on
2026-08-24 (backup kept beside it) so the first run lands Sunday as he
chose; the schema fix makes that unnecessary for the next owner.

**Prioritization pass 2026-08-26:** No blockers, small effort, concrete AC with a named user complaint behind it. Promoted `in-review` → `ready`.
