---
id: APP-008
title: Replace the bash regex boundary with an OS sandbox; cards stay UX
priority: P2
effort: M
component: desktop-app
status: ready
related: [APP-003, APP-004]
blockers: []
dependencies: ["Evidence from real owner command and approval usage"]
github_issue: null
created: 2026-08-22
updated: 2026-08-23
---

## Problem

The evidence this item was waiting for arrived on 2026-08-23: the first live
onboarding stalled on sensible read-only compounds, silently swallowed
`lore setup --yes`, and ended with the `lore profile` write missing the
exact regex — "blocked by your Lore store's desktop policy." APP-021
widened the gate (read-only classifier, guiding non-terminating blocks),
but string matching is still doing a security boundary's job, and every
future skill change risks another silent stall.

## Proposed approach

Sandbox-first, per the 2026-08-23 research below: run the agent's bash
under Anthropic's sandbox-runtime (seatbelt on macOS) scoped to
`$LORE_HOME` plus read-only `~/.claude` and `~/.codex`, network off.
Anything the sandbox contains runs without a prompt; the approval cards
remain only for the owner-meaning writes (capture, profile, publish
draft), as UX rather than enforcement. Evaluate `pi-sandbox` as the
drop-in before hand-rolling; if `sandbox-exec` is unavailable, fall back
to the current APP-021 policy, never to open bash. A learned classifier
stays out of scope until the sandbox is the floor.

## Acceptance criteria

- [ ] Agent bash runs inside an OS sandbox limited to `$LORE_HOME` (rw),
      `~/.claude` and `~/.codex` (ro), no network.
- [ ] The read-only classifier and exact-command table stop being the
      security boundary; cards still gate capture/profile/publish drafts.
- [ ] Sandbox unavailable → fall back to the APP-021 policy with a logged
      warning, never to unrestricted bash.
- [ ] A command that escapes the sandbox scope fails with a reason the
      model can act on, without ending the turn.
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
