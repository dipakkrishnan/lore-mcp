---
id: CAP-031
title: End a hosted sign-in only on an answer, not on any request to the callback address
priority: P2
effort: XS
component: capture
status: in-review
related: [CAP-009, CAP-030, APP-120]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-12
updated: 2026-10-12
---

## Problem

While the owner is on an app's approval page, Lore listens on a loopback
port for the browser's redirect (`_Landing.do_GET` in `lore/signin.py`). It
takes any GET whose path is `/callback` as the answer, whatever its query. A
request carrying neither a `code` nor an `error` (`/callback`,
`/callback?state=…`, `/callback?code=` with nothing after it) therefore ends
the sign-in at once. The requester is shown "Lore was not let in", the owner
is told "<App> didn't let Lore in. Try again.", and the loopback closes, so
an approval given a moment later has nowhere to land.

This is about a request that says nothing, such as a reload or a probe of
the address. A request that carries a made-up code still ends the sign-in
after this item; see the notes.

## Proposed approach

In `do_GET`, treat a `/callback` request as the answer only when its query
has a non-empty `code` or `error`. Answer anything else with a 400, without
either landing sentence, and keep waiting.

## Acceptance criteria

All in tests on loopback only, with `Loopback.wait` patched short.

- [ ] `GET /callback` with no query, with a query that has neither `code`
      nor `error`, and with `code=` or `error=` left blank, each get a 400
      whose body contains neither landing sentence, and none ends the wait.
- [ ] A `/callback?code=…&state=…` request sent after one of those gets the
      "Lore is connected" page, and `callback()` returns that code and state.
- [ ] `/callback?error=access_denied` still ends the wait at once with the
      "Lore was not let in" page and `OAuthFlowError("access_denied")`.
- [ ] With only such empty requests and no answer, `callback()` raises
      `OAuthFlowError("no answer from the browser")` when the wait ends.

## Notes

Reported from reading the code in PR #435 (tests for `lore/signin.py`), which
left it unpinned. Reproduced for this item on `main` at `18a5f5f` by driving
`Loopback().callback()` directly, inside `with Loopback()` as
`HostedReader.sign_in` does. Each of `/callback`, `/callback?`,
`/callback?foo=bar`, `/callback?state=xyz`, `/callback?code=` and
`/callback?error=` ended the wait in the time it took to send it, with a 200
and the "was not let in" page. A real `/callback?code=abc&state=xyz` sent
straight after an empty one got a connection reset.

Read from the code, not run: the sentence `HostedReader.sign_in` shows the
owner, and that `sign_in` forgets the saved sign-in before it starts
waiting, so an owner who was signing in again to an app that was working is
left signed out of it.

Not observed: a real browser, extension or other program sending such a
request. The port is random for each sign-in and bound to `127.0.0.1` only,
so this is a robustness gap more than an exposure. `P2` is a first guess for
prioritization to correct.

Not asked for here:

- Ignoring a callback whose `state` is wrong. The loopback is never told the
  state (the SDK makes it and checks it after the wait has ended), so a
  request with any code and the wrong state still ends the sign-in, as a
  failure. Nothing can forge a sign-in that way, but anything on the Mac
  that can reach the port can still end one. Closing that means handing the
  loopback the state, which is a bigger change.
- Keeping the saved sign-in until the new one succeeds. That affects every
  failed sign-in, including a real refusal, and is its own decision.

`CAP-030` is the other way this wait ends wrongly: too late. Both change the
same few lines. Do `CAP-030` first, or both together: once an empty
`/callback` request no longer ends the wait, it becomes one more stray
request that restarts the clock there, so until `CAP-030` is done the last
criterion holds only to within twice the limit.

Open PR #355 proposes an item, not on `main` yet, that gives a timed-out
sign-in its own sentence by matching the message "no answer from the
browser". Today an empty callback request raises that same message at once,
so it would be reported as a timeout; with this item done that message
again means only that the time ran out.
