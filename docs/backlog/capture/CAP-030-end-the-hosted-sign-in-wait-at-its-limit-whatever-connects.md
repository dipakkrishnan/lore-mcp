---
id: CAP-030
title: End the hosted sign-in wait at its limit, whatever connects to the loopback
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-009, CAP-031, APP-120]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-12
updated: 2026-10-12
---

## Problem

Signing in to Granola, Notion or Readwise waits for the browser on a loopback
port (`Loopback` in `lore/signin.py`). The wait is meant to end after
`Loopback.wait`, 300 seconds. Two things make it run longer:

- **A request for anything but `/callback` late in the window starts the
  clock again.** Each `handle_request` is given the whole limit as its own
  timeout, and the deadline is only checked between requests. One stray
  request just before the limit buys almost a second full wait, so the
  sign-in can sit for close to ten minutes.
- **A connection that sends nothing holds the wait for as long as it stays
  open.** `_Landing` sets no socket timeout and the server reads one
  connection at a time, so `handle_request` blocks on the silent connection's
  first line with no limit at all. The browser's real callback queues behind
  it. If the limit passes while it is held, the sign-in fails as soon as the
  silent connection closes, and the queued callback is never read.

The desktop's `signIn` (`state.cjs`) streams `lore sources connect <app>`
with no timeout of its own, so there the wait ends only when the owner
cancels.

## Proposed approach

Keep one deadline for the whole wait. Before each `handle_request`, set the
server's timeout to the time left, so a finished request cannot extend it.
Give `_Landing` a short per-connection `timeout` (the handler class supports
one) that is never longer than the time left, so a connection that sends
nothing is dropped and the loop moves on to the next one.

## Acceptance criteria

All in tests on loopback only, with `Loopback.wait` and the per-connection
timeout both patched short. "The connection timeout" below is that second
value.

- [ ] With no callback, and one request for another path sent shortly before
      the limit, `callback()` raises `OAuthFlowError` no later than the limit
      plus the connection timeout. Today it takes almost twice the limit.
- [ ] With no callback, and a connection that is opened, sends nothing and
      stays open well past the limit, `callback()` raises no later than the
      limit plus the connection timeout. Today it returns only when that
      connection closes.
- [ ] A `/callback` request carrying a code, sent while a silent connection
      is open and more than one connection timeout before the limit, gets
      the "Lore is connected" page, and its code is what `callback()`
      returns.
- [ ] A request for another path still does not end the wait, and a refusal
      (`error=access_denied`) still ends it at once.
- [ ] Each test closes the connections it holds after a bounded time and
      asserts on the time the wait took; none waits anywhere near 300
      seconds.

## Notes

Reported from reading the code in PR #435 (tests for `lore/signin.py`), which
left both unpinned. Reproduced for this item on `main` at `18a5f5f` by
driving `Loopback().callback()` directly, inside `with Loopback()` as
`HostedReader.sign_in` does, with `Loopback.wait` patched to 2 seconds:

| What connected | How the wait ended |
|---|---|
| nothing | failed after 2.0 s |
| `GET /favicon.ico` at 1.6 s | failed after 3.8 s |
| `GET /favicon.ico` every 1.5 s | failed after 3.4 s |
| a connection sending nothing, open from 0.5 s to 8.5 s | failed after 8.9 s |
| a connection sending nothing, open from 0.3 s to 6.3 s, and `/callback?code=…` sent at 0.8 s | failed after 6.7 s; the callback's request got a connection reset at 6.7 s |
| limit raised to 6 s, silent connection open from 0.3 s to 3.3 s, `/callback?code=…` sent at 0.8 s | the code, after 3.6 s |

So a stray request stretches the wait to at most twice the limit, because
the deadline is checked after each one; only the silent connection is
unbounded. A silent connection that lets go before the limit delays the
callback and does not lose it.

Not reproduced, and not known to happen: a real browser doing either.
Whether a browser opens a connection to the redirect address and leaves it
silent (a speculative preconnect) is a guess; a favicon request is what
`_listen`'s own comment expects. Read from the code, not run: that the
desktop has no timeout of its own, and what `HostedReader.sign_in` tells the
owner afterwards. Whether Ctrl-C ends a wait that is blocked on a silent
connection at a terminal was not tried.

Not asked for here: a connection that keeps sending a byte now and then. A
per-connection timeout limits each read, not the whole request, so such a
client is never dropped. Nothing ordinary behaves that way.

`CAP-031` is the other way this wait ends wrongly: too early, on a request
to `/callback` that carries no answer. Both change the same few lines. Do
this one first, or both together: once `CAP-031` stops an empty `/callback`
request from ending the wait, that request becomes one more stray request
that restarts the clock here.

Open PR #355 proposes two neighbouring items that are not on `main` yet:
one testing the loopback's edges, including the plain timeout, and one
giving a timed-out sign-in its own sentence instead of "didn't let Lore in".
Neither covers a wait that outlasts its limit.
