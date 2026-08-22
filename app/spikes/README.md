# Desktop app de-risking spikes

Two Electron-free spikes from `docs/desktop-app.md`. Throwaway by design:
what graduates into the app is the *shape* — `LoreKernel` in `src/kernel.ts`
(Pi's native skills layer plus the three-tool surface) and the
`CredentialStore` seam — not this code.

```sh
npm install

# Spike 1 (APP-003): subscription sign-in end to end.
# OAuth login → file-backed CredentialStore (safeStorage stand-in) →
# getAuth with refresh → one real completion.
npm run auth                    # Claude subscription
npm run auth -- openai-codex    # ChatGPT subscription
npm run auth -- anthropic api_key

# Spike 2 (APP-004/XC-005): a Lore owner skill under Pi with the exact
# desktop tool surface (lore_cli allowlist, scoped read, ask_user), skills
# managed by Pi's native skills layer, in a terminal REPL against a temp
# Lore home (~/.lore-spike-home).
npm run harness                        # lore-capture
npm run harness -- lore-onboard
npm run harness -- lore-capture --real # real ~/.lore — attended only
```

Pass/fail questions each spike answers:

1. Does a Claude/ChatGPT subscription power embedded Pi with no API key, and
   does the credential survive restart through a store the app can back with
   Keychain? Does `getAuth` refresh without bespoke token code?
2. Does the skill complete with only the three tools — including the
   cross-skill handoffs (capture → publish, onboard → enable-payments,
   publish ↔ enable-payments), which resolve by reading the routed skill
   through the scoped read tool? Every step that doesn't is a skill bug to
   log (and fix in the skill), not a reason to widen the surface. Also: does
   capture through this feel *better* than capture through Claude Code — the
   APP-003 checkpoint gate.

Credentials land in `~/.lore/spike-credentials.json` (mode 600). Delete it
to log out.
