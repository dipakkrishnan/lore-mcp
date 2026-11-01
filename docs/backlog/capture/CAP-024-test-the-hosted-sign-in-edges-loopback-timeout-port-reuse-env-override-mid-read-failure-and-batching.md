---
id: CAP-024
title: Test the hosted sign-in edges (loopback timeout, 404, port reuse, env override, mid-read failure, batching, pacing)
priority: P1
effort: M
component: capture
status: in-review
related: [CAP-009, CAP-015, CAP-025, XC-057, XC-052, CAP-016]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The hosted reader's failure paths are half-tested. `tests/test_hosted.py`
covers the code landing (`:322`), an explicit refusal (`:326`), an expired
sign-in (`:127`), a renamed tool (`:116`) and an all-fail read, but not:
the loopback **timeout** (`signin.py:83-87`; 300 s with no browser answer
→ `OAuthFlowError("no answer from the browser")` → "didn't let Lore in",
F-gr-03); a request for anything but `/callback` (404, `:94-96`); the
landing page texts (`:100-104`); two sign-ins in a row binding fresh
ports; the `LORE_<APP>_SERVER` override (`sources.py:1143-1144`) that the
edge walk relies on but no unit test asserts; a server that fails on the
second of three ids (partial items kept, `errors` counted, state
`unreachable`, `:1027-1033`); how many `get_meetings` calls N meetings
cost (one each; the vendor allows 10 per call); and whether Notion's
2 s pause is applied across list **and** fetch calls (it is list-only;
23 back-to-back fetches were fine live, ASSUMED safe).

## Proposed approach

All component tests against the in-process stubs `test_hosted.py`
already has; no new modules, no network.

### Files

- change `tests/test_hosted.py`
- change `tests/fixtures/granola.py` only if a "fail on the nth id"
  switch is easier there than in an inline `MCPServer` (prefer inline)

### Test design

1. `test_an_unanswered_approval_is_a_failed_sign_in` (F-gr-03): patch
   `Loopback.wait = 0.2`; run `Loopback().callback()` with no request →
   `OAuthFlowError` whose message is `no answer from the browser`; through
   `HostedReader.sign_in` with `_auth` patched to drive the SDK's callback
   → `SourceError("Granola didn't let Lore in. Try again.")` (today's
   text; `CAP-025` changes it and updates this assertion).
2. `test_the_loopback_answers_only_callback`: GET `/favicon.ico` → 404 and
   the server keeps listening; then GET `/callback` with a `code` and a
   `state` query parameter (any two short test values) → 200, body
   contains `Lore is connected`, `answer` is a dict of exactly those two
   keys and values; GET `/callback` with `error=access_denied` → 200 body
   `Lore was not let in` and `callback()` raises
   `OAuthFlowError("access_denied")`.
3. `test_two_sign_ins_bind_fresh_ports` (resil): two `Loopback()`
   instances in sequence and one overlapping → three distinct
   `redirect` URLs, all `http://127.0.0.1:<port>/callback`.
4. `test_the_server_address_can_be_overridden_by_environment`: with
   `LORE_GRANOLA_SERVER=http://127.0.0.1:1/mcp`, `Granola().address("")`
   returns it; `address("https://typed")` wins over the env; unset →
   `https://mcp.granola.ai/mcp`. Same for `LORE_NOTION_SERVER`.
5. `test_a_server_that_fails_mid_read_keeps_what_it_read`: stub whose
   fetcher raises on the second of three ids (an exception, not
   `is_error`) → `imported 1`, `errors 2`, state `unreachable`; a second
   `read` after the stub recovers → `added 2`.
6. `test_perf_one_fetch_per_meeting_today`: three meetings → the stub's
   `read` list has three calls of one id each; the docstring says the
   vendor allows 10 per call and points to the decision in `CAP-015`'s
   notes (pin now; a batching change flips this to one call).
7. `test_perf_notion_pauses_between_list_pages_only`: patch
   `anyio.sleep` to record calls; two list pages and five fetches →
   exactly one `sleep(2.0)`; docstring records the ASSUMED-safe rate.
8. `test_refused_unwraps_nested_exception_groups`: `_refused(
   ExceptionGroup("a", [ExceptionGroup("b", [OAuthFlowError("x")])]))` is
   True; a group without one is False (extends `:127`).
9. `test_sec_a_vendor_401_is_not_a_refusal`: `failing(httpx2.HTTPStatusError
   (401 …))` → state `needs_permission`? No: `_refused` is
   OAuth-only, so it is `unreachable` today (F-gr-02). Pin that, with a
   comment that `CAP-025` surfaces the vendor's text.

## Acceptance criteria

- [ ] Tests 1-9 exist and pass with no network and `FakeKeyring`.
- [ ] Test 1 completes in under 2 s (patched `wait`), never 300.
- [ ] Test 4 restores the environment (`patch.dict(os.environ)`).
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-09 (loopback timeout/404/page text, `_refused`, env override,
vendor error mapping, batching), W-10 (pacing across list and fetch),
W-17 (timeout, port reuse), W-19 (mid-read hosted failure), C-13, C-14,
C-22; F-gr-02, F-gr-03, R-05.

Flakiness/safety: loopback binds port 0; `wait` is patched short; all
servers are in-process.
