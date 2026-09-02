---
id: APP-038
title: dogfood:new's HOME override hangs/breaks Keychain-backed sign-in
priority: P1
effort: M
component: desktop-app
status: in-progress
related: [APP-005, APP-013, APP-039]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-01
updated: 2026-09-02
---

## Problem

Provider sign-in (`auth:login`, for both `anthropic` and `openai-codex`)
throws `ModelsError: Credential store modify failed for <provider>: Keychain
is unavailable`. `CredentialStore#save` (`app/desktop/src/credentials.mjs:27`)
guards on `safeStorage.isEncryptionAvailable()` and throws exactly this error
when it returns `false`.

**Correction (2026-09-02):** the original theory here ("the build is
unsigned") was wrong and has been disproven. Root cause, confirmed by direct
testing on the owner's Mac:

`support/dogfood.sh`'s `new` case launches the app with `HOME` overridden to
a sandbox directory. Overriding `$HOME` makes macOS treat Electron's
`safeStorage` Keychain lookup as belonging to an unrecognized identity, which
triggers a `SecurityAgent` authorization prompt (confirmed via `ps` — a
`SecurityAgent` process spawns at the exact moment `isEncryptionAvailable()`
is called). That prompt is never shown/answered in this launch path, so the
call hangs indefinitely; in the packaged-app repro it manifested as a fast
`false`/error instead of a visible hang, but the trigger is the same `HOME`
override.

Isolated with a minimal Electron probe script calling
`safeStorage.isEncryptionAvailable()` directly via the same (unsigned) dev
`electron` binary the app itself uses:
- Real `$HOME`, no other env: returns `true` immediately.
- Real `$HOME` + `LORE_DESKTOP_USER_DATA` set (matches everything the app
  itself needs `dogfood:new` to isolate): returns `true` immediately.
- `$HOME` overridden to a fresh sandbox dir: hangs indefinitely; a
  `SecurityAgent` process appears in `ps` the moment the call is made.

So this has nothing to do with code signing — a plain unsigned dev binary
works fine under the real `$HOME`. It also has nothing to do with the
automated-vs-interactive launch context distinction raised in the original
version of this item (the user reproduced it via a normal interactive
`npm run dogfood:new` too) — the actual variable is `$HOME` itself.

## Proposed approach

Fix applied: drop the `HOME=` override from `dogfood.sh`'s `new` case.
Nothing the app itself reads depends on it — `uv` provisioning is fully
scoped via explicit `UV_TOOL_DIR`/`UV_TOOL_BIN_DIR`/`UV_PYTHON_INSTALL_DIR`/
`UV_CACHE_DIR` env vars (`src/runtime.cjs`), the Lore library path comes from
`LORE_HOME`, and `credentials.bin` lives under `app.getPath("userData")`,
which `LORE_DESKTOP_USER_DATA` already redirects. Verified the exact env
combo the patched script now uses (`LORE_HOME` + `LORE_DESKTOP_USER_DATA`,
no `HOME`) returns `isEncryptionAvailable() === true` immediately, and ran
the patched `npm run dogfood:new` end to end through `uv` provisioning
without a hang.

One real, known tradeoff from this fix: `bashSandboxPolicy`
(`src/agent.mjs`) does use `os.homedir()` (which respects `$HOME`) to scope
what the `setup`/`deploy` tasks' bash sandbox can read/write — `OWNER_DIRS`
like `.codex/automations`, `.wrangler`, `.npmrc`. With `$HOME` no longer
overridden, a `dogfood:new` pass that reaches the `setup`/`deploy` tasks now
shares those directories with the real user's home instead of a clean
sandbox, which is a real (if narrower) loss of "fresh machine" fidelity for
that later part of the dogfood pass. Not fixed here — flagged for whoever
picks this up next to decide whether it's worth a more surgical fix (e.g.
isolating just those `OWNER_DIRS` without touching `$HOME`/Keychain
resolution at all).

## Acceptance criteria

- [x] Root cause confirmed and documented (see Problem section).
- [x] Fix implemented: `dogfood.sh`'s `new` case no longer overrides `HOME`.
- [ ] A person completes the actual sign-in click in `npm run dogfood:new`
      end to end (this item's own testing only verified the underlying
      `safeStorage` mechanism and that the app launches; no one has clicked
      through sign-in to confirm the full UI path yet).
- [ ] Decide whether the `bashSandboxPolicy`/`OWNER_DIRS` fidelity loss noted
      above needs its own follow-up item or is an acceptable tradeoff.

## Notes

Full repro stack trace (packaged build, before the fix):

```
Error occurred in handler for 'auth:login': ModelsError: Credential store modify failed for anthropic: Keychain is unavailable
    at ModelsImpl.login (.../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/models.js:336:19)
    ...
  code: 'auth',
  [cause]: Error: Keychain is unavailable
      at #save (.../app/desktop/src/credentials.mjs:27:58)
```

Same error reproduced for both `anthropic` and `openai-codex` provider ids.

Caution for whoever investigates the `SecurityAgent` mechanism further: do
not run `security default-keychain -s ...` / `security list-keychains -s
...` in your normal shell to test a "pre-provision a keychain inside the
sandbox" fix idea — those are session-wide preferences keyed to the real
login session, not scoped by `$HOME`, and running them un-sandboxed
overwrites the real Mac's actual default keychain and search list. (Caught
and reverted during this investigation; restored to
`~/Library/Keychains/login.keychain-db` + `/Library/Keychains/System.keychain`.)
That path was abandoned as too risky to bake into an automated script for
this reason, in favor of just not overriding `$HOME`.
