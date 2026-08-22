---
id: APP-003
title: Embed Pi behind one desktop capture input
priority: P1
effort: M
component: desktop-app
status: completed
related: [APP-002, CAP-001]
blockers: [APP-002]
dependencies: []
github_issue: null
created: 2026-08-21
updated: 2026-08-22
---

## Problem

The read-only shell can show Lore but cannot provide the agent-guided capture
experience that makes Lore useful. Building a second bespoke assistant loop
would duplicate the Pi runtime already used by the paid-answer path and lose
its model, tool, and lifecycle support.

## Proposed approach

Run Pi's supported `createAgentSession()` runtime in Electron's main process
and expose one persistent input in the renderer. Load the existing capture
skill with Pi's native read and Bash tools plus Lore's `ask_user` extension.
Forward Pi lifecycle events to show real tool activity. A pre-execution hook
auto-allows only anchored read-only Lore commands, asks once for the exact
private-capture heredoc, and blocks every other Bash command.

Sign-in uses `pi-ai`'s existing OAuth flows — `auth/oauth/anthropic` for a
Claude subscription and `auth/oauth/openai-codex` for a ChatGPT subscription —
with a pasted API key as the fallback, so a non-technical owner never has to
create a developer key. Implement `pi-ai`'s `CredentialStore` interface over
Electron `safeStorage` (Keychain-backed); the store already serializes refresh
inside `modify`, so no bespoke token plumbing. Subscription credentials power
only the owner's local attended agent; the deployed node keeps its own
API-key secrets and its existing bypass of Pi's auth layer.

## Acceptance criteria

- [x] A user can type or use operating-system dictation in one input and
      complete an attended `lore-capture` flow through embedded Pi.
- [x] Pi runs outside the renderer; IPC exposes prompts, structured questions,
      lifecycle data, and the one private-save approval.
- [x] A Pi `tool_call` extension auto-allows only complete read-only Lore
      commands, asks once for the exact private-capture heredoc, and blocks
      malformed, non-Lore, compound, and owner-only commands before execution.
- [x] Tool activity shown in the UI comes from actual Pi lifecycle events.
- [x] Provider credentials are never stored in Lore SQLite, renderer storage,
      logs, or job payloads.
- [x] A local test script runs a synthetic capture session and verifies the
      resulting private memory through Lore's real store.
- [x] Sign-in completes with a Claude or ChatGPT subscription through Pi's
      existing OAuth flows, or with a pasted API key, and the credential
      round-trips through the `safeStorage`-backed store across app restarts.

## Notes

Dipak wants to implement a Pi `AskUserQuestion` extension. Keep one small
structured-question seam with a plain-text fallback; do not put Lore workflow
logic inside that extension. Contract for that seam: one `AgentTool` named
`ask_user` whose parameters mirror Claude Code's `AskUserQuestion` —
`questions: [{ question, header, options: [{ label, description }],
multiSelect }]` — executed by forwarding over IPC to the renderer and awaiting
the owner's selection; the result is the selected labels plus optional free
text. The plain-text fallback renders the question as ordinary chat text and
accepts a typed reply, so no skill ever blocks on the control being available.
Approval cards are not this tool: approvals are app-invoked UI that routes to
a dedicated CLI command Pi cannot call.

Native macOS dictation is sufficient for the first version, so custom audio
capture is out of scope.

Use Pi 0.84.2's supported `createAgentSession()`/`AgentSession` path. Do not
add a second assistant loop or replace native read/Bash with custom Lore
wrappers. Pi's `tool_call` extension hook is the security boundary for Bash;
the product prompt is guidance, not enforcement.

Implementation was explicitly approved and promoted by the owner on
2026-08-22 after APP-002 completed.

Implemented with Pi's native `AgentSession`, read, Bash, and lifecycle events.
The only Lore tool is `ask_user`; Pi's supported pre-execution hook enforces a
deterministic three-way Bash policy. A real Electron run denied a synthetic
save without mutation, then allowed it once and verified private memory #1
through the temporary Lore store. Electron `safeStorage` round-tripped a
credential across two app processes.
