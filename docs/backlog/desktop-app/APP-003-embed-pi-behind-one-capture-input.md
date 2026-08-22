---
id: APP-003
title: Embed Pi behind one desktop capture input
priority: P1
effort: M
component: desktop-app
status: in-review
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

Run Pi Agent Core in Electron's main process and expose one persistent input in
the renderer. Start with the existing attended capture and read/search
capabilities; do not add publishing, payment, or deployment writes in this PR.
Forward Pi lifecycle events only to show real tool and job activity.

Sign-in uses `pi-ai`'s existing OAuth flows — `auth/oauth/anthropic` for a
Claude subscription and `auth/oauth/openai-codex` for a ChatGPT subscription —
with a pasted API key as the fallback, so a non-technical owner never has to
create a developer key. Implement `pi-ai`'s `CredentialStore` interface over
Electron `safeStorage` (Keychain-backed); the store already serializes refresh
inside `modify`, so no bespoke token plumbing. Subscription credentials power
only the owner's local attended agent; the deployed node keeps its own
API-key secrets and its existing bypass of Pi's auth layer.

## Acceptance criteria

- [ ] A user can type or use operating-system dictation in one input and
      complete an attended `lore-capture` flow through embedded Pi.
- [ ] Pi runs outside the renderer and exposes only named Lore tools through
      narrow IPC.
- [ ] Tool activity shown in the UI comes from actual Pi lifecycle events.
- [ ] Provider credentials are never stored in Lore SQLite, renderer storage,
      logs, or job payloads.
- [ ] A local test script runs a synthetic capture session and verifies the
      resulting private memory through Lore's real store.
- [ ] Sign-in completes with a Claude or ChatGPT subscription through Pi's
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

Run raw Pi `Agent`, not `AgentHarness`: as of pi 0.84.2 the harness is
published and typed but the pi CLI's own main loop still runs on
`createAgentSession()` over raw `Agent` — the same substrate as our Worker
answer path. Revisit harness (and its SQLite session backend) once pi's CLI
cuts over to it. The skills layer (`loadSkills` and friends) is
production-load-bearing in pi today and is safe to use.
