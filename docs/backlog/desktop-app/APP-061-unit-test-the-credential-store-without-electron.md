---
id: APP-061
title: Unit-test the credential store without Electron
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-038, APP-058, APP-008]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-03
updated: 2026-09-03
---

## Problem

`CredentialStore` (`app/desktop/src/credentials.mjs`) holds the owner's
provider credentials on disk. Its only test spawns Electron through
`support/credential-roundtrip.cjs` and is `{ skip: process.platform !==
"darwin" }`, so it proves exactly one path — write an API key, relaunch, read
it back — and proves nothing at all off macOS.

The class takes `safeStorage` by constructor injection, so a stub makes all of
it reachable from plain `node --test`. What that would cover, and nothing
covers today:

- **`#enqueue` serialization.** Every `modify`/`delete` is a load-mutate-save
  round trip, and the per-provider promise chain is the only thing stopping
  two of them from interleaving and losing a write — an OAuth refresh landing
  while the owner pastes an API key. The chain exists precisely because that
  race is real, and nothing asserts it holds.
- **`list()`** — never called by any test.
- **Keychain unavailable.** `#save` throws "Keychain is unavailable" when
  `isEncryptionAvailable()` is false; `APP-038` is an open report of that
  path misbehaving on unsigned builds, still with no test pinning it.
- **A corrupt or foreign `credentials.bin`.** `#load` swallows `ENOENT` and
  rethrows everything else, so a file that won't decrypt propagates. Whether
  that leaves the owner stuck at sign-in, or recoverable, is untested and
  currently unknown.
- **The on-disk guarantees** — `0o600` and the write-temp-then-rename, so a
  crash mid-write can't truncate the real file.

## Proposed approach

Add a `test/credentials.test.cjs` (or a section of `app.test.cjs`) that
constructs `CredentialStore` against a temp dir and a stub `safeStorage`
whose `encryptString`/`decryptString` are reversible and whose
`isEncryptionAvailable()` is switchable. Keep the Electron round-trip test as
the one thing that proves the real Keychain path; everything else moves to
the fast, platform-independent tests.

## Acceptance criteria

- [ ] Two concurrent `modify` calls on the same provider both land — neither
      write is lost — asserted by a test that fails against an unchained
      implementation.
- [ ] `list()`, `delete`, keychain-unavailable, and an undecryptable file each
      have a test stating the expected behavior.
- [ ] The stored file is `0o600` and is written via a temp file and rename.
- [ ] The new tests run on every platform (no `skip`), and the Electron
      round-trip test stays as the real-Keychain proof.

## Notes

Found while auditing desktop test coverage (2026-09-03). Four of
`test/app.test.cjs`'s tests are darwin-gated; CI's `desktop-check` runs on
`macos-14`, so they do run there — but they are also the only coverage those
surfaces have, which makes each one a single point of failure.
