# Desktop app de-risking spikes

Two Electron-free spikes from `docs/desktop-app.md`. Throwaway by design:
what graduates into the app is the *shape* — Pi's supported coding-agent SDK,
native `read` and `bash`, the `ask_user` extension seam, and the
`CredentialStore` seam — not this code.

```sh
npm install

# Spike 1 (APP-003): subscription sign-in end to end.
# OAuth login → file-backed CredentialStore (safeStorage stand-in) →
# getAuth with refresh → one real completion.
npm run auth                    # Claude subscription
npm run auth -- openai-codex    # ChatGPT subscription
npm run auth -- anthropic api_key

# Spike 2 (APP-004/XC-005): a Lore owner skill under Pi's production
# AgentSession SDK with native read/bash plus ask_user, in a terminal REPL
# against a temp Lore home (~/.lore-spike-home).
npm run harness                        # lore-capture
npm run harness -- lore-onboard
```

Pass/fail questions each spike answers:

1. Does a Claude/ChatGPT subscription power embedded Pi with no API key, and
   does the credential survive restart through a store the app can back with
   Keychain? Does `getAuth` refresh without bespoke token code?
2. Does the skill complete with Pi's native tools plus `ask_user` — including the
   cross-skill handoffs (capture → publish, onboard → enable-payments,
   publish ↔ enable-payments)? Also: does capture through this feel *better*
   than capture through Claude Code — the APP-003 checkpoint gate.

`npm run harness` is an attended integration smoke, not an automated test. It
proves that a real subscribed model can load a packaged Lore skill, call Pi's
native tools, ask structured questions, and mutate the disposable Lore store.
It does not test Electron, IPC, app sandboxing, approval cards, packaging, or a
live payment.

The spike gives Pi an unsandboxed shell. Keep it attended and use only the
disposable Lore home; the shipped app needs an OS sandbox or explicit command
approval before native bash is safe.

Credentials land in `~/.lore/spike-credentials.json` (mode 600). Delete it
to log out.
