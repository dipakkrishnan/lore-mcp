---
id: XC-060
title: Keep a milestone unsent until the relay has taken it
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [APP-058, XC-030, CLI-004, XC-031, XC-061, XC-062]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-10
updated: 2026-10-10
---

## Problem

`lore/usage.py` marks a milestone as sent before it tries to send it:
`_record` writes the key into the `usage_sent` setting, then calls `_log`
and `_send`, and `_send` posts from a background thread that swallows every
`OSError`. When the POST fails (laptop offline, the 2-second timeout, a 5xx,
a 429 where the relay's rate limit is bound, or a relay with no `/events`
route yet), `record` still returns True and that install never sends the
milestone again. Milestones are sent once per install by design, so one
failed request is a permanent hole in the funnel `APP-058` exists to
measure.

The same ordering loses a milestone in two more ways:

- If `usage.log` cannot be written, `_log` raises after the mark, `_send`
  never runs, and `record` returns False with the milestone used up.
- If no relay is pinned (`feedback.RELAY_URL` is None and `LORE_USAGE_URL`
  is unset), `_send` returns early after the mark. `main` pins a relay, so
  this only affects a build that removes it.

## Proposed approach

Mark a `once` or `daily` key only when the relay has answered. The mark
moves to where the answer is known: either the post thread writes it, or
the send is awaited inside the existing `TIMEOUT_SECONDS` budget.

Open questions, to settle while building it:

- **What counts as taken.** The relay answers `202 {"accepted": N}` before
  it forwards anything, and discards a forwarding failure. It drops events
  it does not recognise (`accepted: 0`) and keeps nothing without a
  `POSTHOG_KEY`. A 202 is the most the client can see, so decide whether
  `accepted: 0` marks the milestone or not.
- **Failures that will never succeed.** The relay's 400 and 413 are
  permanent for that request. Retrying them forever helps nobody.
- **How often to retry.** An install that is offline for good should not
  start a request on every `lore capture`. Once per milestone per day may
  be enough.
- **Duplicates.** A request that arrives but whose answer is lost will be
  sent again. Either accept that (the funnel counts installs, not events)
  or give each event a stable id the sink can drop repeats on.
- **The local log.** `PRIVACY.md` says every event sent is written to
  `~/.lore/usage.log`. Today the log is written before the send, so it can
  list an event that never arrived, but never misses one that left. Keep
  that direction.

## Acceptance criteria

- [ ] With the relay unreachable, `record("store.opened")` leaves
      `store.opened` out of `usage_sent`. Once the relay is reachable, an
      attempt the retry rule allows delivers it.
- [ ] Once the relay has accepted a milestone, later calls send nothing
      (today's once-per-install behaviour).
- [ ] The daily `app.opened` behaves the same way: a failed send does not
      use up the day.
- [ ] A `usage.log` that cannot be written does not use up the milestone.
- [ ] With no relay pinned and no override, nothing is marked sent.
- [ ] Retries are bounded: an install that stays offline does not start a
      request on every command. `record` still never raises and adds no
      more wait to a command than it does today.
- [ ] Every event put on the wire is in `~/.lore/usage.log`, and the log
      tells apart the ones the relay did not confirm.
- [ ] `tests/test_usage.py` covers each line above against a local stand-in
      relay.

## Notes

Found while writing the send-path tests in PR #431 and left unpinned there
so a fix would not look like a regression; that PR's reviewer asked for a
backlog entry. Read from `lore/usage.py` and `feedback-relay/src/index.ts`
on `main` at `9b33deb`: `store.set_setting(SENT_SETTING, ...)` runs inside
`_record`'s `with Store()` block, before `_log(event)` and `_send(event)`.

Filed on its own instead of in `APP-058`'s notes because `APP-058`'s
criteria are about what is sent and the off switch; none of them covers
delivery, and this is independently completable.

For prioritization: `APP-058`'s notes list deploying the relay and setting
`POSTHOG_KEY` as remaining, while `main` already pins `RELAY_URL` and sends.
If the `/events` route or the key is not live, every install is using up
its once-only milestones now, and this is worth more than `P2`. The
deployed state was not checked when this was filed.

Tests that describe today's behaviour and will change with the
`usage.log` criterion: `test_every_event_sent_is_in_the_local_log` in
`tests/test_usage.py`, and
`test_a_relay_that_refuses_or_errors_never_fails_the_command` if PR #431
merges.

The fix must keep privacy rule 5 in `docs/telemetry.md`: a retry repeats the
same milestone, it never says how many times something happened.
