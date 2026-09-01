---
id: APP-038
title: Sign-in fails with "Keychain is unavailable" on unsigned builds
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-005, APP-013, APP-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-01
---

## Problem

Provider sign-in (`auth:login`, for both `anthropic` and `openai-codex`)
throws `ModelsError: Credential store modify failed for <provider>: Keychain
is unavailable`. `CredentialStore#save` (`app/desktop/src/credentials.mjs:27`)
guards on `safeStorage.isEncryptionAvailable()` and throws exactly this error
when it returns `false`. Reproduced twice on the owner's Mac: once via
`npm --prefix app/desktop start` (dev, unpackaged `electron .`), and again via
the packaged `Lore.app` (`npm run package` then `npm run dogfood:new`), the
second time launched directly from a normal interactive Terminal session —
so this is not an artifact of a headless or automated launch context. Because
sign-in is the first step of the README's own dogfood first-run pass, this
blocks that pass entirely on this machine right now.

Likely root cause: the build is unsigned. `app/desktop/README.md` states
"Signing is wired but inert" pending `LORE_SIGN_IDENTITY` and Apple API
credentials, and Electron's macOS `safeStorage` Keychain backing is known to
be unreliable for unsigned/ad-hoc-signed app bundles — not yet confirmed by
directly testing against a signed build.

## Proposed approach

Unclear — needs investigation. First confirm the root cause: build with
`LORE_SIGN_IDENTITY` set (once Apple credentials are available, tracked under
APP-005) and check whether `safeStorage.isEncryptionAvailable()` then returns
`true` on the same machine. If signing does fix it, this item is mostly a
tracking/regression-test placeholder until APP-005's credentials land. If it
does *not* fix it, investigate further (Keychain ACL state left over from
prior ad-hoc-signed runs under a different identity, `keychain-access-groups`
entitlement, or a stale/locked login keychain) and consider a fallback
credential store (e.g. an encrypted-at-rest file keyed by a locally generated
secret) so dogfooding and CI-less local testing aren't blocked on signing.

## Acceptance criteria

- [ ] Root cause confirmed: reproduce against a `LORE_SIGN_IDENTITY`-signed
      build and record whether `isEncryptionAvailable()` returns `true`.
- [ ] Either signing is confirmed sufficient (link this item's resolution to
      APP-005's signing credentials landing and re-verify), or a concrete fix
      /fallback is implemented and verified against an unsigned dev build.
- [ ] The dogfood first-run pass in `app/desktop/README.md` can complete the
      sign-in step on an unsigned local dev build, a signed build, or both,
      per whichever fix path is chosen.

## Notes

Full repro stack trace (packaged build):

```
Error occurred in handler for 'auth:login': ModelsError: Credential store modify failed for anthropic: Keychain is unavailable
    at ModelsImpl.login (.../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.js:336:19)
    ...
  code: 'auth',
  [cause]: Error: Keychain is unavailable
      at #save (.../app/desktop/src/credentials.mjs:27:58)
```

Same error reproduced for both `anthropic` and `openai-codex` provider ids.
