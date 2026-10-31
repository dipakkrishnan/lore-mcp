---
id: XC-112
title: Say a broken answer from the hosted store plainly, not as a Python error
priority: P2
effort: XS
component: cross-cutting
status: in-review
related: [APP-181, XC-088]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-31
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

- [ ] With a stand-in server, each of these makes `Hosted.sql` raise `HostedError`
      with the text `"{fail}. {BUSY}"`: connection closed before a response, reset
      mid-body, truncated body, bad status line, 200 non-JSON, 200 non-object JSON,
      and 200 with `results` missing or not a list.
- [ ] An HTTP error whose body can't be read raises the same `HostedError` and keeps
      its status.
- [ ] The same cases through `lore agents list` exit non-zero with no exception name
      and no "Traceback" on stderr.

## Notes

Separate from APP-181, whose criterion 2 covers the visible symptom across every
tab; this is the one fix in `hosted.py`. Not reproduced, from reading only: a
truncated relay answer in `feedback.submit` skips the spool update the same way.
