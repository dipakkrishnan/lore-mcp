---
id: CAP-025
title: "Bug: a timed-out sign-in and a refusal read the same, and the vendor's reason is thrown away"
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-009, CAP-024, XC-057, APP-178, XC-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Two observations from the Granola sign-in (F-gr-02, F-gr-03; R-05):

1. A person whose Google account has no Granola account is answered
   `Unauthorized: user has not created a Granola account yet` by the
   server, and Lore shows `Lore couldn't reach Granola. Try again.`
   (`sources.py:995-1000` keeps only "refused or not"). They cannot learn
   why, and "try again" is wrong advice.
2. Leaving the approval page unanswered for five minutes ends in
   `OAuthFlowError("no answer from the browser")`, which `_refused`
   treats like `access_denied`: both say `Granola didn't let Lore in. Try
   again.` The owner who simply missed the tab is told the app refused
   them.

## Proposed approach

Failing tests first (in `tests/test_hosted.py`), then two small changes
in `HostedReader.sign_in`.

### Files

- change `lore/sources.py` (`HostedReader.sign_in`, a helper `_reason`)
- change `lore/signin.py` only if the timeout needs its own exception
  type (prefer: keep `OAuthFlowError`, match the message
  `no answer from the browser`)
- change `tests/test_hosted.py`, `app/desktop/support/edge.cjs` if it
  asserts the old text (`:421-441` asserts a failed sign-in; check)
- change `docs/connectors.md` (the three texts)

### Behaviour

- timeout: `SourceError("Granola didn't hear back from your browser. Try
  again and approve Lore on the page it opens.")`
- refusal (`access_denied` or any other `OAuthFlowError`): unchanged
  `"<app> didn't let Lore in. Try again."`
- any other failure: if the exception chain (walk `exceptions` groups
  and `__cause__`) contains an `httpx2.HTTPStatusError` whose response
  body is non-empty text, append the first line of it, trimmed to 120
  characters and with any email-shaped or token-shaped substring
  removed: `"Lore couldn't reach Granola. Granola says: Unauthorized:
  user has not created a Granola account yet"`; otherwise unchanged.

### Test design (failing first)

1. `test_a_timed_out_sign_in_says_the_browser_never_answered`: with
   `Loopback.wait` patched short (as in `CAP-024` test 1) →
   `SourceError` text is the new timeout sentence; `access_denied` still
   yields "didn't let Lore in".
2. `test_the_vendors_reason_is_shown_when_it_has_one`:
   `failing(HTTPStatusError(...))` built with a `httpx2.Response(401,
   text="Unauthorized: user has not created a Granola account yet")` →
   message ends with `Granola says: Unauthorized: user has not created a
   Granola account yet`; a `Response(502, text="")` → the plain "couldn't
   reach" sentence; a body containing `token=abc…` or an address at
   `example.com` is not echoed (the redaction).
3. `test_the_desktop_sees_one_line`: the message contains no newline
   (`state.cjs:230` uses the last stderr line).

## Acceptance criteria

- [ ] Tests 1-3 fail before the change (test 1 on the text, test 2 on the
      missing suffix) and pass after.
- [ ] The three owner-facing texts are listed in `docs/connectors.md` and
      contain no vendor jargon beyond the quoted reason.
- [ ] `support/edge.sh connectors` still passes locally.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-09 (vendor error text; timeout vs refusal), W-17 (timeout
reads differently), W-19 (vendor error text swallowed), C-13, C-22;
F-gr-02, F-gr-03, R-05.

Flakiness/safety: the vendor text in the test is the observed sentence,
which contains no identity; never paste a real error body with an
account id.
