---
id: XC-061
title: Send a milestone once whatever value comes with it
priority: P3
effort: XS
component: cross-cutting
status: in-review
related: [APP-058, CLI-004, XC-060, XC-062]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-10
updated: 2026-10-10
---

## Problem

A milestone is meant to be sent once per install, but an event that carries
no property can be sent again by passing it a value. `usage.record` checks
the value only for events that have a property, and `_record` puts whatever
it was given into the once-key (`f"{name}:{value}"`). So
`record("memory.saved", "x")` and `record("memory.saved", "y")` use two
keys and both send, and a plain `record("memory.saved")` afterwards sends a
third. The value itself never leaves the machine; the repeated milestone
does.

## Proposed approach

Either refuse a value on an event that carries none, the way a value
outside an event's list is refused today (`ValueError` from `record`), or
ignore the value and key the milestone on its name alone. Refusing is
closer to the closed list in `contracts/usage_events.json`.

Whichever is chosen, an install that already sent `memory.saved` holds the
key `memory.saved:` and must not send it again after the change.

## Acceptance criteria

- [ ] `record("memory.saved", "x")` followed by `record("memory.saved",
      "y")` sends at most one event and leaves at most one key for
      `memory.saved` in `usage_sent`.
- [ ] An install whose `usage_sent` already holds `memory.saved:` sends
      nothing for `record("memory.saved")` or `lore telemetry record
      memory.saved x`.
- [ ] `tests/test_usage.py` covers both.

## Notes

Found while writing the send-path tests in PR #431 and left unpinned there.
Read from `lore/usage.py` on `main` at `9b33deb`.

Reach today is small. No caller in `lore/cli.py` passes a value to a
prop-less event, and the desktop app only runs `lore telemetry record
<name>` with no value (`app/desktop/src/main.cjs`). The way in is a
hand-typed `lore telemetry record memory.saved x`, since the parser takes
an optional free-form value, or a future Python caller.

If the fix refuses the value, `lore telemetry record memory.saved x` goes
through the CLI's error handler, exits 1 and sends `cli.failed` with
`other`. Decide whether that is wanted.

Filed apart from `APP-058` because it is a small defect with its own fix
and test, and apart from `XC-062` because the two have different fix sites
and different reach.
