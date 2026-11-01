---
id: XC-052
title: Prove sign-in tokens never leave the Keychain, and pin what Lore imports verbatim
priority: P1
effort: S
component: cross-cutting
status: in-review
related: [CAP-009, CAP-024, XC-051, APP-001, STO-002, XC-048]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Two security facts about connectors are observed but untested.

1. Hosted sign-ins keep tokens and client registration only in the macOS
   Keychain (`lore/signin.py:25-59`, service `Lore`, usernames
   `<server> tokens` / `<server> client`). `tests/test_snapshot.py:174-177`
   checks that `desktop-state` leaks no *other* secrets, and
   `tests/test_hosted.py:293` round-trips the Keychain, but nothing asserts
   that after a sign-in **no file under `LORE_HOME`**, no
   `sources list --json` row, no `desktop-state` output and no log line
   contains the token, and that `sign_in` refreshes both the `tokens` and
   the `client` entry (`sources.py:985` forgets both; the test at
   `test_hosted.py:137` checks tokens only).
2. Lore has no secret detector: obs-06 (a fake API key) and obs-07 (a fake
   phone number) were imported as private memories, searchable verbatim
   (`tests/fixtures/live/obsidian/cli.jsonl`). That is the intended
   behaviour today, and it is undocumented in the suite, so a future
   "helpful" filter or an accidental one would change import counts
   without any test saying why.

## Proposed approach

Add `test_sec_*` tests to the files that own the code; no new modules.

### Files

- change `tests/test_hosted.py`
- change `tests/test_sources.py`
- change `tests/test_snapshot.py`

### Test design

`tests/test_hosted.py`

1. `test_sec_a_sign_in_leaves_nothing_but_keychain_entries`: with
   `FakeKeyring` and `serving(Granola().server)`, seed the fake keyring
   with an `OAuthToken(access_token="tok-" + 40 hex)` and a client info
   entry, run `Registry.connect("granola", "", show=lambda url: None)`,
   then `Registry.read`, `Registry.entries()`, `snapshot.build(store)`
   and `cli.main(["sources","list","--json"])` under `captured()`. Assert
   the literal access token string appears in **none** of: any file under
   `LORE_HOME` (walk and read bytes, including `lore.db`), the JSON
   outputs, the snapshot dict (`json.dumps`), or `logging` records captured
   with `self.assertNoLogs`/a handler on the root logger.
2. `test_sec_signing_in_refreshes_both_keychain_entries`: pre-seed stale
   `tokens` and `client` values; after `sign_in`, both keys in
   `FakeKeyring.saved` are absent or differ from the stale values (the SDK
   writes new ones only when it registers; with the in-process stub it
   registers nothing, so assert both are **gone**).
3. `test_sec_disconnect_forgets_both_entries_and_forgetting_twice_is_quiet`:
   after `remove(name)`, both keys are absent; a second `Keychain.forget()`
   raises nothing.

`tests/test_sources.py`

4. `test_sec_a_folder_note_with_a_fake_key_is_imported_verbatim`: temp
   vault with a note containing the persona's fake key line from
   `support/seed/persona.md` (`TWILIO_KEY=tw_live_sk_…`) and one with the
   reserved-range phone number; `Registry.add(folder)` imports both;
   `Store.search("tw_live_sk_4f3c9a1e7b2d4e5f6a7b8c9d0e1f2a3b")` returns
   the note, status `private`. A docstring states this pins the *absence*
   of a secret filter and names `STO-002` as where retention decisions
   live.

`tests/test_snapshot.py`

5. `test_sec_desktop_state_sources_carry_no_locator_secrets`: a hosted
   source row exposes `locator` = the server URL and nothing that matches
   `eyJ[A-Za-z0-9_-]{8,}\.` or `access_token`.

## Acceptance criteria

- [ ] Tests 1-5 exist under the `test_sec_` prefix and pass.
- [ ] Test 1 fails if a `print(tokens)` is added to
      `HostedReader.sign_in` or the token is written to any file under
      `LORE_HOME` (verified once by hand while writing the test).
- [ ] No test touches the real Keychain (`FakeKeyring` installed via
      `keyring.set_keyring`, as `HostedTest.setUp` does) or the network.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-17 (tokens never on disk/logs/JSON; `client` entry freshness),
W-16 (hosted remove forgets Keychain), W-02 (obs-06/07 "secrets are not
detected"), W-20 (subprocess JSON contract, no secrets), C-21, C-24,
C-25; manifest items obs-06, obs-07 (`private_data`).

Flakiness/safety: the fake token is a fixed string built in the test;
never copy a real token shape from a recording (recordings are scrubbed
to `JWT.REDACTED`, which is fine to grep for as a negative).
