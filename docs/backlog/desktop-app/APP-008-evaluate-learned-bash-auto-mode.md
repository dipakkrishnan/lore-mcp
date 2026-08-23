---
id: APP-008
title: Evaluate learned Bash auto mode after real use
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-003, APP-004]
blockers: []
dependencies: ["Evidence from real owner command and approval usage"]
github_issue: null
created: 2026-08-22
updated: 2026-08-23
---

## Problem

APP-003's deterministic Bash rules are intentionally narrow. Evolving skill
commands may eventually create approval friction or remain blocked until the
rules catch up, but adding a learned classifier before real usage demonstrates
that problem would add cost and uncertainty to a working security boundary.

## Proposed approach

Wait for real command and approval evidence. If it shows material friction,
evaluate an optional learned risk signal only inside a deterministic envelope
of commands already eligible to run; deterministic hard-denies execute first
and cannot be overridden. Unavailable, uncertain, or malformed classifier
output falls back to the deterministic decision.

## Acceptance criteria

- [ ] Real owner usage demonstrates and documents approval friction or repeated
      safe-command lag before implementation begins.
- [ ] Deterministic hard-denies remain authoritative for non-Lore, compound,
      owner-only, and otherwise unsupported commands regardless of classifier
      output.
- [ ] The classifier is described and tested as a prompt-reduction hint, never
      as a security boundary, and failure falls back to the deterministic
      policy.
- [ ] A bounded comparison shows fewer unnecessary prompts without increasing
      the set of commands eligible to bypass deterministic hard-denies.

## Notes

Do not log private capture payloads or send credentials to collect the evidence
for this decision.

## Research (2026-08-23)

pi ships no permission system by design — the `tool_call` hook is the
sanctioned gating seam, and pi's own docs say sandbox/VM for enforcement.
Ecosystem survey: `@gotgenes/pi-permission-system` (rules engine, ~30K
dl/mo, mature) is the strongest rules option; `pi-sandbox` (~5K dl/mo)
wraps Anthropic's sandbox-runtime (macOS seatbelt) with
allow-temporarily/permanently prompts; three LLM-classifier extensions
exist (`pi-auto-permissions`, `pi-cruise-control`, ACP) but all are under
two months old. Industry pattern (Claude Code auto mode, Codex CLI):
classifier/rules for convenience, OS sandbox as the actual boundary —
Anthropic's classifier caught 89% of dangerous commands vs 13.6% for
humans, and they still pair it with rules plus a sandbox.

Direction for Lore: sandbox-first. Run bash under sandbox-runtime scoped
to `$LORE_HOME` plus the agent-memory read paths with no network;
auto-approve anything the sandbox contains; keep approval cards only for
the owner-meaning writes (capture/profile/publish) as UX, not as the
security mechanism; drop the exact-regex table as the boundary. Evaluate
`pi-sandbox` as the drop-in before hand-rolling.
