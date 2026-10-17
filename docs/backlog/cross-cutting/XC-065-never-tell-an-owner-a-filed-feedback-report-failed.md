---
id: XC-065
title: Never tell an owner a feedback report failed after GitHub filed it
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-028, XC-031, CLI-003, APP-105, XC-066]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-15
updated: 2026-10-15
---

## Problem

The feedback relay (`feedback-relay/src/issue.ts`, `createIssue`) treats a
GitHub `201` as success only when the reply body also reads as JSON with
`number` and `html_url`. When it doesn't, the issue already exists, but:

- **Body not JSON** (e.g. an HTML page with a 201): `response.json()` throws,
  `index.ts` catches it as an unexpected error and answers
  `502 {"error":"could not file the issue"}`. `lore/feedback.py` turns any 5xx
  into "the feedback service is unavailable (502); try again later. Your
  report is saved at <path>". An owner who does as told files the same public
  issue twice.
- **JSON without `number` or `html_url`**: the relay answers `201 {"ok":true}`
  with both fields dropped by `JSON.stringify`. `Receipt` in
  `lore/feedback.py` requires `issue_url: str` and `issue_number: int`, so
  `submit` raises "the feedback service returned an unreadable response", the
  CLI and the desktop sheet show an error, and the spool file records an
  error for a report that was filed.

Both reproduced on 4693678 by calling the Worker's `fetch` directly with
GitHub mocked to answer 201 with `<html>` (502) and with `{}` (`201
{"ok":true}`). The client consequences are read from code.

## Proposed approach

Once GitHub has answered 201, the relay answers 201. It passes through
`number` and `html_url` when they have the right types, sends `null` for
whichever does not, never echoes the upstream body, and logs the unreadable
reply for the maintainer. It does not invent a link.

On the client, `Receipt.issue_url` and `Receipt.issue_number` become
optional. When the URL is missing, the CLI says the report was filed and
GitHub did not return a link, and points at the repository's
`feedback`-labelled issues; it does not print `Filed as` for a non-issue
page. The desktop sheet (which shows `Filed as ${receipt.url}`) gets the same
wording; `state.cjs`'s `reportFeedback` JSDoc changes to nullable fields.

Rejected: a distinct non-2xx status for "filed, no link". Every non-2xx goes
through `urllib`'s `HTTPError` and `_relay_error`, so it would need its own
client path and would still read as a failure to clients already shipped.

## Acceptance criteria

- [ ] GitHub 201 with a body that is not JSON: the relay answers 201 with
      `ok: true`, `issue_url: null`, `issue_number: null`, nothing from the
      upstream body in the response, and the reply logged.
- [ ] GitHub 201 with JSON missing or mistyping `number` or `html_url`: the
      relay answers 201 with the good field passed through and the bad one
      `null`. A well-formed reply is answered exactly as today.
- [ ] Any non-201 GitHub answer, and an unreachable GitHub, still give 502
      `could not file the issue` (existing tests unchanged).
- [ ] PR #451's relay test that pins 502 for a 201-with-HTML reply (if merged
      first) is updated to assert the 201 above.
- [ ] `lore/feedback.py`'s `submit` accepts a receipt with null fields: no
      exception, and the spool file holds the receipt and no `error`.
- [ ] `lore report-feedback --json` prints `{"url": null, "number": null}` for
      it; human mode says the report was filed without a link and names where
      to find it, and does not say `Filed as`.
- [ ] The desktop feedback sheet shows a filed-without-link message for a
      null `url`, and `state.cjs`'s `reportFeedback` JSDoc types both fields
      as nullable; `npm run check` in `app/desktop` passes.

## Notes

Found by PR #451 (tests for the relay's entry point), item 1 and 2 of its
"Behaviours I noticed and did not pin".

The relay is live (`RELAY_URL` in `lore/feedback.py` is
`https://relay.yourlore.dev/report`), so clients already released keep an
`int`-only `Receipt` and will still show "unreadable response" for a null
number until they update. That is still better than today's 502: a
`ValueError` does not carry the "try again later" wording, so a duplicate is
less likely. The relay change is needed regardless, because only the relay can
see that GitHub answered 201.

A GitHub 201 with an unreadable body is rare. The more likely duplicate is the
client's own 10 s timeout (`TIMEOUT_SECONDS`): GitHub files the issue, the
client times out and says "timed out; try again later". Out of scope here;
worth its own item if it shows up in practice.

The desktop half touches `app/desktop/src/renderer.js`, which several open
PRs also edit; the relay and Python halves can ship first on their own.
