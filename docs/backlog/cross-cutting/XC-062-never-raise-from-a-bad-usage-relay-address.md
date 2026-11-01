---
id: XC-062
title: Never raise from a bad usage relay address
priority: P3
effort: XS
component: cross-cutting
status: in-review
related: [APP-058, CLI-004, XC-060, XC-061]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-10
updated: 2026-10-10
---

## Problem

`usage.record` says it never fails the command that observed the event, and
`APP-058` requires that analytics failures never interrupt a user action.
It catches `OSError` and `sqlite3.Error` only. `_send` builds its
`urllib.request.Request` on the calling thread, and a `LORE_USAGE_URL`
without a scheme (`not-a-url`) makes that raise `ValueError: unknown url
type`, which escapes `record`.

With that override set:

- A command that fails prints its error, then `lore/cli.py`'s error handler
  calls `record("cli.failed", ...)`, which raises, so a traceback follows
  the error.
- A command that works and reaches a milestone for the first time (`lore
  capture`, approving a piece, `lore node deploy`, listing on the
  marketplace) raises from `record` after its work is done. The handler
  reports `lore: unknown url type`, then raises again from its own
  `record("cli.failed", ...)`. A successful command ends in a traceback.

Only an install with the override set is exposed, so this is development
and test setups, not owners.

## Proposed approach

Treat an address `urllib` cannot use as no relay: catch it in `_send`, send
nothing, return normally.

## Acceptance criteria

- [ ] With `LORE_USAGE_URL=not-a-url`, `record("cli.failed", "other")`
      returns without raising and makes no request.
- [ ] With that override, a failing `lore` command prints its own error and
      no traceback.
- [ ] With that override, a succeeding command that reaches a milestone for
      the first time exits 0 with its normal output.
- [ ] `tests/test_usage.py` or `tests/test_cli.py` covers each line above.

## Notes

Found while writing the send-path tests in PR #431 and left unpinned there.
Read from `lore/usage.py` and `lore/cli.py` on `main` at `9b33deb`; the
call sites are the `usage.record(...)` lines in `main`, `capture_apply` and
the publication and marketplace handlers. That a scheme-less address raises
`ValueError` when the `Request` is built is standard `urllib` behaviour and
was reproduced in PR #431, not re-run here.

`XC-060` changes when a milestone is marked sent. If it lands first, a bad
address should also leave the milestone unmarked.

Filed apart from `APP-058` because it is a small defect with its own fix
and test.
