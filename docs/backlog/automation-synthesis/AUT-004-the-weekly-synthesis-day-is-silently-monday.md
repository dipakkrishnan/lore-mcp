---
id: AUT-004
title: The weekly synthesis day is silently Monday, whatever the owner was told
priority: P1
effort: S
component: automation-synthesis
status: completed
related: [AUT-001, AUT-002, APP-030]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-24
updated: 2026-09-12
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

- [x] The profile stores an explicit weekday for weekly cadence; `lore
      profile` validates it.
- [x] `_rrule()` and the launchd path derive the day from the profile;
      no hardcoded Monday.
- [x] The onboarding scheduling exchange offers the day, and the
      confirmation echoes exactly what was installed.
- [x] Tests cover a weekly Sunday profile end to end.

## Notes

Dipak's installed automation was hand-corrected to `BYDAY=SU` on
2026-08-24 (backup kept beside it) so the first run lands Sunday as he
chose; the schema fix makes that unnecessary for the next owner.

**Prioritization pass 2026-08-26:** No blockers, small effort, concrete AC with a named user complaint behind it. Promoted `in-review` → `ready`.

**Completed 2026-09-12.** Scope turned out smaller than described: `windup`'s
`Task` dataclass (`windup/src/windup/tasks.py`) already carries a `weekday`
field and `_rrule()` already derives `BYDAY` from it — that side was already
fixed, presumably as a byproduct of the monthly-cadence work. The actual bug
was entirely in `lore/automation.py`: `AutomationProfile` had no `weekday`
field at all, and `task_for()` never passed one to `Task(...)`, so every
schedule silently used the dataclass's `weekday=1` default regardless of what
an owner picked. Fixed by adding `weekday` (0=Sunday..6=Saturday, matching
windup's convention) to the profile schema, with the same manual
range-validation `task_for()` already does for `hour` (persisted JSON bypasses
pydantic, so a corrupt on-disk value must not silently become a bad schedule).
When unset, `task_for()` defaults to the install day via
`(date.today().weekday() + 1) % 7`, converting Python's Monday=0 convention to
windup's Sunday=0. Updated `lore-onboard/SKILL.md`'s scheduling exchange to
ask for the day on a `weekly` cadence and echo it back exactly, and added
`weekday` to its `lore profile` example. Tests added: an explicit-Sunday
end-to-end case, an invalid-weekday rejection case mirroring the existing
invalid-hour one, and a default-to-install-day case with `date.today()`
mocked to a known Wednesday. The pre-existing
`test_a_codex_schedule_hands_off_with_no_claude_specific_grants` now pins
`weekday=1` explicitly so its `BYDAY=MO` assertion no longer depends on
whatever day it happens to run.

Did not touch `lore/snapshot.py`'s `schedule_state()` — the desktop app's
"what did we actually install" surface (APP-084) has its own exact-dict-shape
test in `tests/test_snapshot.py`, and adding a `weekday` key there is outside
this item's stated acceptance criteria.

**Note on verification:** this session's sandbox hard-blocks `uv run`/`python3`
execution (confirmed via both a direct attempt and a fresh subagent), so
`ruff check`, `ruff format --check`, `python -m unittest`, and `mypy` could
not actually be run here. The change was hand-traced against windup's
`_rrule()`/`Task.__post_init__` and against the existing test patterns instead
of executed. Flagging this plainly rather than claiming a green run — the
reviewer pass on the PR should run the real CI commands.
