---
id: APP-014
title: Say why a capture failed, pick a supported model, render memory Markdown
priority: P0
effort: S
component: desktop-app
status: completed
related: [APP-003, APP-011, APP-013]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

With only a ChatGPT sign-in, every capture showed "Lore is thinking…" and
then nothing. Two causes stacked. The session picked the first openai-codex
model in pi's list — `gpt-5.3-codex-spark`, which OpenAI refuses for ChatGPT
accounts — and when the turn ended with `stopReason: "error"` and no text,
the app forwarded nothing, so the owner saw the spinner stop and no reason.
Separately, the memory sheet from APP-011 showed synthesized Markdown as raw
text with literal `#` and `-`.

## Proposed approach

Choose the model through pi's own scoping (`resolveModelScopeWithDiagnostics`)
with an explicit preference list — `anthropic/claude-sonnet-5`,
`openai-codex/gpt-5.5`, `openai/gpt-5.5` — and fall back to the first
available model. Emit an assistant turn that ends in `error` or `aborted` as
a message carrying pi's `errorMessage`, so the log says why. Render the sheet
body with `marked` (pinned, loaded as a local UMD script under the existing
CSP) with raw HTML blocks dropped.

## Acceptance criteria

- [x] A turn that ends in a model error shows the provider's message in the
      agent log instead of going silent.
- [x] With only a ChatGPT credential, a capture reaches the approval card
      (verified live against the owner's account on 2026-08-23).
- [x] The memory sheet renders headings, lists, inline code, and paragraphs;
      raw HTML in a memory is dropped, not rendered.
- [x] Desktop typecheck and tests pass.

## Notes

Diagnosed by launching the packaged app with `--remote-debugging-port` and
calling `window.lore.prompt` over CDP while tailing main's stderr; the
assistant `message_end` carried "The 'gpt-5.3-codex-spark' model is not
supported when using Codex with a ChatGPT account." `marked`'s `renderer`
option replaces the whole renderer; the HTML override must go through
`marked.use()`.
