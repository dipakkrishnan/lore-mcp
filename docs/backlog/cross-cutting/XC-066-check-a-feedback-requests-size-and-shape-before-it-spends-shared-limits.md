---
id: XC-066
title: Check a feedback request's size and shape before it spends the relay's shared limits
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-028, XC-031, APP-058, XC-065]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-15
updated: 2026-10-15
---

## Problem

`POST /report` in `feedback-relay/src/index.ts` calls `allow()` before it
reads the body, so a request the relay is going to refuse still spends
`GLOBAL_RATE_LIMIT` (60 a minute on one constant key, per Cloudflare location)
and a slot in the `FEEDBACK_QUOTA` Durable Object (60 a minute, 300 an hour,
shared by every owner). That covers a body over the 128 KB cap sent without a
usable `Content-Length` (chunked, or a non-numeric header: `Number("abc")` is
`NaN` and `NaN > cap` is false), invalid JSON, and a report `parseReport`
refuses.

So 60 garbage posts a minute, from 12 addresses at the per-IP limit of 5,
turn feedback off for every owner, and create no issue anyone would notice.
The relay is live (`RELAY_URL` in `lore/feedback.py`), so this is not
hypothetical. XC-028's design notes put the cheap layers first so a refused
request never spends quota, but "refused" there only means refused by a
limiter.

`POST /events` reads the whole body with `request.text()` and re-encodes it
before checking its 8 KB cap, and never looks at `Content-Length`. The
platform caps request bodies (100 MB on Free/Pro), so this is not unbounded,
but two in-memory copies of a body that size count against the isolate's
128 MB. The per-IP `EVENTS_RATE_LIMIT` runs first, so the cost falls on the
flooding address.

Reproduced on 4693678 by calling the Worker's `fetch` directly with the rate
limiters unbound: an oversize body declaring `Content-Length: 10`, the body
`nope`, and a report with an empty title each left both quota windows at 1,
and after 60 `nope` posts a valid report got 429 without GitHub being called.
The `/events` order is read from code.

## Proposed approach

Split `allow()`. The per-IP `FEEDBACK_RATE_LIMIT` may stay ahead of the read,
since it only costs the sender's own address. The body is then read with a
byte-capped reader (stop at cap + 1 bytes), parsed, and passed through
`parseReport`. Only a report that is about to be sent to GitHub takes
`GLOBAL_RATE_LIMIT` and then the quota, in that order. Keep the
declared-length early rejection and decide explicitly whether a non-numeric
`Content-Length` is a 413 or ignored.

Give `/events` the same declared-length rejection and capped read, with
`EVENTS_RATE_LIMIT` staying first.

Update the comments that describe the old order: `limit.ts`'s "a request that
was going to be refused anyway never spends quota" and `wrangler.jsonc`'s
"both ahead of FEEDBACK_QUOTA as cheap pre-filters".

## Acceptance criteria

- [ ] A body over the cap with no `Content-Length`, invalid JSON, and a report
      `parseReport` refuses each get the status and message they get today,
      leave both quota windows at 0, and never call a counting fake
      `GLOBAL_RATE_LIMIT` passed in through `env`. (A fake is needed: the real
      rate-limit bindings are not exercised by direct calls, so a test with
      them unbound would pass against the old order.)
- [ ] With that fake global limiter allowing 60 a minute, 60 invalid requests
      followed by a valid report: the valid report is filed (201).
- [ ] A valid report takes exactly one global-limiter call and one slot in
      each quota window.
- [ ] A request the per-IP limiter refuses is still 429 before its body is
      read.
- [ ] `/report` and `/events` refuse an over-cap body without buffering more
      than cap + 1 bytes of it (a counting `ReadableStream` is one way to
      check), and refuse a declared `Content-Length` over the cap before
      reading.
- [ ] The behaviour chosen for a non-numeric `Content-Length` is pinned by a
      test.
- [ ] The existing relay, limit and events tests pass, and the two comments
      above describe the new order.

## Notes

Found by PR #451 (tests for the relay's entry point), items 3 and 4 of its
"Behaviours I noticed and did not pin".

Reading raw bytes also fixes a smaller miscount: `request.text()` replaces
each invalid UTF-8 byte with U+FFFD, which re-encodes as 3 bytes, so a body
just under the cap with invalid bytes can be refused as too large.

XC-031 still reads `status: ready` although the relay is deployed; not changed
here.
