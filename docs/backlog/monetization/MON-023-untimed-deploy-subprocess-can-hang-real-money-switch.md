---
id: MON-023
title: An untimed deploy subprocess can hang the real-money switch indefinitely
priority: P1
effort: M
component: monetization
status: in-review
related: [MON-012]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/262
created: 2026-09-09
updated: 2026-09-09
---

## Problem

During a manual real-money-switch test, after the owner entered one of two
required CDP secrets, the app's composer stayed locked on "Lore is
working…" indefinitely — confirmed stuck (byte-identical state) across a
gap of several hours spanning a sleep/wake cycle, not just a slow call.
Checking the node's vault directly (`wrangler secret list`) showed
`CDP_API_KEY_SECRET` stored but `CDP_API_KEY_ID` never requested or stored.

Two plausible explanations were investigated and ruled out with code
evidence:

- **Not a hidden two-turn requirement.** `app/desktop/src/agent.mjs:524-534`
  (`#attended`) and the per-turn `MAX_TURNS` counter
  (`agent.mjs:510-513`) confirm the agent framework chains multiple tool
  calls — including two sequential `store_secret` calls — within one
  `prompt()`/turn. Nothing requires a fresh owner message between them.
- **Not a renderer defect dropping the second prompt.** The secret-prompt
  fallback in `renderRequest` (`app/desktop/src/renderer.js:1238-1266`)
  always has a non-empty `message`; `openTask(...).then(...)`
  (`renderer.js:1613-1616`) cannot silently fail to render given
  `openTask`'s internal `.catch(() => [])`.

Root cause, confirmed by reading the actual vendored code: the skill's
mainnet section (`plugins/lore/skills/lore-enable-payments/SKILL.md:290-296`)
runs `lore node deploy --network real` as a plain `bash` tool call — not
through the IPC-timeout-protected `lore()` helper that `storeSecret` itself
uses (`app/desktop/src/state.cjs:18-27`, which does carry a 120s `execFile`
timeout). The actual bash tool implementation
(`app/desktop/node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js`)
enforces **no default timeout**:

```js
timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
...
if (timeoutMs !== undefined) { timeoutHandle = setTimeout(() => { ...killProcessTree(child.pid); }, timeoutMs); }
```

A kill-timer only exists if the model supplies a `timeout` parameter on that
specific call; neither `SKILL.md`'s example nor any tool description in
`agent.mjs` instructs it to. Underneath, `lore/deploy.py`'s `_deploy()`
(`lore/deploy.py:344-442`) chains several `subprocess.run` calls via `_run()`
(`lore/deploy.py:133-156`) — `npm install`, `wrangler deploy`,
`wrangler secret put`, `push_job`, a `remote_manifest()` smoke check — and
**none pass `timeout=` or `stdin=DEVNULL`**, so if `wrangler` ever tries to
prompt interactively in this unattended context, nothing bounds the wait.

The observed symptom is consistent with the agent storing one secret, then
starting the deploy via `bash` with no timeout, and that call stalling
somewhere in the subprocess chain with nothing in the stack able to time it
out.

## Proposed approach

- Have the skill's deploy step pass an explicit `timeout` on the `bash`
  tool call for `lore node deploy`, or move the deploy invocation through
  the same IPC-timeout-protected `lore()` helper `storeSecret` already uses
  instead of a raw `bash` call.
- Add `timeout=` and `stdin=subprocess.DEVNULL` to every `subprocess.run`
  call in `lore/deploy.py`'s `_deploy()` chain, so no single step (npm
  install, wrangler deploy, secret put, push, smoke check) can hang the
  whole flow indefinitely.
- Consider whether a partial CDP-secret state (one of two stored) should be
  detectable/recoverable from the UI — right now there is no visible
  indication anything went wrong, just a permanently locked composer.

## Acceptance criteria

- [ ] `lore node deploy --network real` (and `--network test`) cannot hang
      the desktop app's turn indefinitely — either the bash call carries a
      timeout, or the invocation goes through a timeout-protected path
- [ ] Every `subprocess.run` in `lore/deploy.py`'s deploy chain sets a
      timeout and `stdin=subprocess.DEVNULL`
- [ ] A deploy that times out surfaces a visible error to the owner rather
      than leaving the composer locked with no explanation

## Notes

Cataloged from GitHub issue #262. Root-caused during the same manual-test
session that filed it — see the issue's later comments for the full trace,
including the two ruled-out theories and their supporting evidence.

Left a real (though incomplete and unusable without its pair) CDP secret on
a live node's vault; this is a data-hygiene side effect worth a manual
cleanup on the affected account, not itself part of this item's scope.
