---
id: XC-112
title: Say a broken answer from the hosted store plainly, not as a Python error
priority: P1
effort: XS
component: cross-cutting
status: completed
related: [APP-181, XC-088]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-11
---

## Problem

`Hosted._send` in `lore/hosted.py` turns `HTTPError`, `URLError` and `TimeoutError`
into a plain `HostedError`. APP-181 (#599) did that for status codes, but other
failures still get past it, because `urlopen` doesn't wrap `getresponse()` or the
body read. Reproduced on 454fd933 against a local stand-in, calling `Hosted.sql`:

| The store's answer | What escapes | What `lore` does with it |
|---|---|---|
| Connection closed before a response | `RemoteDisconnected` (an `OSError`) | Prints "Remote end closed connection without response" |
| Truncated body | `http.client.IncompleteRead` (neither `OSError` nor `ValueError`) | Traceback |
| 200 with a non-JSON body | `JSONDecodeError` (a `ValueError`) | Prints "Expecting value: line 1 column 1" |
| 200 with `{}` | `KeyError: 'results'` | Traceback |

The first two are the realistic ones: a dropped connection or a deploy restarting
mid-answer. The last two are defensive, since the Worker always sends `results` and
a captive portal fails TLS first. The desktop shows the last line of a traceback,
so a seller can read `KeyError: 'results'`.

## Proposed approach

Catch the transport and parsing failures in `_send`, and check the shape of
`results` in `sql()`. Raise `HostedError` with the existing `BUSY` wording:
`UNREACHABLE` says the internet is down, which is false once the server has accepted
the connection.

## Acceptance criteria

- [x] With a stand-in server, each of these makes `Hosted.sql` raise `HostedError`
      with the text `"{fail}. {BUSY}"`: connection closed before a response, reset
      mid-body, truncated body, bad status line, 200 non-JSON, 200 non-object JSON,
      and 200 with `results` missing or not a list.
- [x] An HTTP error whose body can't be read raises the same `HostedError` and keeps
      its status.
- [x] The same cases through `lore agents list` exit non-zero with no exception name
      and no "Traceback" on stderr.

## Notes

Separate from APP-181, whose criterion 2 covers the visible symptom across every
tab; this is the one fix in `hosted.py`. Not reproduced, from reading only: a
truncated relay answer in `feedback.submit` skips the spool update the same way.

**Prioritization pass 2026-11-11:** Promoted `in-review` → `ready` and P2 → P1: XS, no blockers, and it is the `hosted.py` half of APP-181 (P1), which can't stop tabs printing Python errors while this path raises them.

**Implementation 2026-11-11:** `_send` now catches `http.client.HTTPException`,
`OSError` and `ValueError` after the existing `URLError`/`TimeoutError` clause (both
are `OSError`s, so the order keeps an offline Mac reading as `UNREACHABLE`), rejects
a JSON answer that isn't an object, and `sql()` rejects `results` that isn't a list;
`_said` also returns None when the error body can't be read, so the status is kept.
`BrokenAnswerTest` in `tests/test_hosted_store.py` drives nine broken modes through the
stand-in (`broken` on `tests/fixtures/hosted.py`), at `Hosted.sql` and through
`lore agents list`.

- A timeout while the body is being read still reads as `UNREACHABLE`, as a timeout
  before the answer does. The item doesn't list that case and it kept the change
  smallest.
- `lore agents list` reaches the hosted store only once an agent is connected on this
  Mac: with none, `Agents.entries()` answers an empty list without a request. The CLI
  test connects one first.
- Follow-up, not done here: a truncated relay answer in `feedback.submit` (from
  reading only) may skip the spool update the same way; file it through
  `backlog-ideate` once confirmed.
