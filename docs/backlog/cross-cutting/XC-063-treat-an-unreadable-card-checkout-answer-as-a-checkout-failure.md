---
id: XC-063
title: Treat an unreadable card checkout answer as a checkout failure
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-039, MON-004, MON-013, APP-089, APP-181]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-11
updated: 2026-10-11
---

## Problem

`lore/cards.py` turns a refusal from Lore's card checkout (a 4xx or 5xx) and
an unreachable checkout into an `OSError` with a plain message, and every
caller in `lore/cli.py` handles `OSError`. A 200 whose body Lore cannot use
is not covered: `_call` lets the parser's own exception through, and
`open_account` and `status` index the result without checking it. Only a
seller who has turned cards on, or is turning them on, is exposed.

The worst case is a push. `_push` writes the edge database, clears
`revocation_pending` and `publish_pending`, and only then calls
`_bind_card_store`, which catches `OSError` alone. When the bind's answer is
unreadable, the write has already landed and:

- **Not JSON, or not UTF-8** (`JSONDecodeError`, `UnicodeDecodeError`, both
  `ValueError`): `lore push` prints `lore: Expecting value: line 1 column 1
  (char 0)` and exits 1, and the run is recorded as failed. After an approval
  or a revocation the handler sets its pending flag back and says the node
  "does not yet serve the new set" or "still serves the old set". Neither is
  true.
- **A body cut short** (`http.client.IncompleteRead`, neither `OSError` nor
  `ValueError`): a traceback, and a failed run for a push that worked.
- **`lore marketplace list` and `delist`**: `Marketplace._switch` puts the
  old listed name back on any failure of its push, so the store keeps one
  name locally while the edge already serves the other.
- **`lore node deploy`**: stops at its first push, before the smoke check,
  with the node live.

Card setup has the same gap:

- `lore cards connect` prints the parser's message for a non-JSON answer, and
  a `KeyError` or `TypeError` traceback for JSON without `account` and
  `token`. The desktop app shows the last line of that as the error.
- An answer of `{"account": null, "token": null}` is accepted. The strings
  `None` and `None` are stored as the pending account and its token, the
  seller is sent to `/onboard?account=None&token=None`, and every later
  `lore cards connect` reuses them instead of opening a real account.
- `lore cards --json`, which the desktop app polls, answers `"ready": null`
  when the checkout is unreachable. For an unreadable answer it exits 1 with
  nothing on stdout, or raises `AttributeError`.

## Proposed approach

In `_call`, read the whole body and require a JSON object; anything else
raises the same kind of `OSError` a refusal does, with its own fixed message.
`open_account` raises it too unless `account` and `token` are both non-empty
strings. The callers then need no change, because they already handle
`OSError`.

## Acceptance criteria

"An unreadable answer" below means a 200 from the checkout with any of: an
HTML body, an empty body, bytes that are not UTF-8, JSON that is not an
object (`[]`, `null`, `"ok"`), or a body shorter than its `Content-Length`.

- [ ] For each unreadable answer, `open_account`, `status` and `bind` raise
      an `OSError` with one fixed message that names Lore's card checkout.
- [ ] `open_account` raises that error when `account` or `token` is missing,
      null, or an empty string.
- [ ] After any of those, `lore cards connect` prints one `lore:` line,
      exits 1, prints nothing on stdout with `--json`, and stores no pending
      account or token.
- [ ] With a pending account, `lore cards --json` prints its usual JSON with
      `"ready": null` and exits 0 for each unreadable answer, as it does
      today when the checkout is unreachable.
- [ ] A remote push whose bind gets an unreadable answer exits 0, warns that
      buyers can't pay by card until the next push, records the run as
      succeeded, and leaves `revocation_pending` and `publish_pending` false.
- [ ] `lore marketplace list --name X`, when its push's bind gets an
      unreadable answer, keeps `X` as the listed name.
- [ ] Each line above is covered by a test that serves the answer from a
      local stub HTTP server, or patches `urlopen` for the cut-short body.

## Notes

Found while writing tests for `lore/cards.py` in PR #433, which listed three
of these from reading the code and left them unpinned. Reproduced on `main`
at `9b33deb` for this item: each answer above was served from a local stub
to `cards.open_account`, `cards.status`, `cards.bind`, `lore cards connect`,
`lore cards --json` and `cli._bind_card_store`, with a temporary
`LORE_HOME`. What a failed bind then does to `_push`, `push_job`,
`_push_after_approval`, `publication_revoke`, `Marketplace._switch` and
`deploy` is read from the code, not run, since a real push needs wrangler.

The checkout Worker answers a JSON object on all three routes
(`checkout/src/index.ts`), and its errors are never a 200. So this needs a
response cut off in transit, a proxy that answers for the checkout, a
`LORE_CHECKOUT_URL` pointed at something else, or a Worker bug. A Cloudflare
challenge page is a 403 and is already reported properly.

Not asked for here:

- Checking the values inside a readable answer. `bind` ignores its answer,
  so any JSON object counts as bound, and `status` reads `"false"` as ready.
  The Worker sends neither.
- Reordering `_push` so the run is recorded before the bind. With the
  criteria above met nothing reaches that window; it would be a second guard.

`APP-089` has the desktop say the store was not updated when a push fails,
and `APP-181` is about raw errors reaching a seller; both show what this
item's failures look like in the app.
