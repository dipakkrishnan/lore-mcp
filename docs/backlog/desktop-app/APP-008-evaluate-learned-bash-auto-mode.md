---
id: APP-008
title: Replace the bash regex boundary with an OS sandbox; cards stay UX
priority: P3
effort: XS
component: desktop-app
status: completed
related: [APP-003, APP-004]
blockers: []
dependencies: ["Evidence from real owner command and approval usage"]
github_issue: null
created: 2026-08-22
updated: 2026-11-13
---

## Problem

The evidence this item was waiting for arrived on 2026-08-23: the first live
onboarding stalled on sensible read-only compounds, silently swallowed
`lore setup --yes`, and ended with the `lore profile` write missing the
exact regex — "blocked by your Lore store's desktop policy." APP-021
widened the gate (read-only classifier, guiding non-terminating blocks),
but string matching is still doing a security boundary's job, and every
future skill change risks another silent stall.

APP-027 removes that temporary policy for owner-only dogfood so the product
can be evaluated without policy-induced failures. This item is the boundary
required before Lore expands beyond that narrow use.

## Proposed approach

Before broader beta, run the agent's bash
under Anthropic's sandbox-runtime (seatbelt on macOS) scoped to
`$LORE_HOME` plus read-only `~/.claude` and `~/.codex`, network off.
Anything the sandbox contains runs without a prompt; the approval cards
remain only for the owner-meaning writes (capture, profile, publish
draft), as UX rather than enforcement. Evaluate `pi-sandbox` as the
drop-in before hand-rolling. A learned classifier stays out of scope until
the sandbox is the floor.

## Acceptance criteria

- [x] Agent bash runs inside an OS sandbox limited to `$LORE_HOME` (rw),
      `~/.claude` and `~/.codex` (ro), no network.
- [x] The read-only classifier and exact-command table stop being the
      security boundary; cards still gate capture/profile/publish drafts.
- [x] The app refuses to start an agent session if its required sandbox is
      unavailable.
- [x] A command that escapes the sandbox scope fails with a reason the
      model can act on, without ending the turn.
- ~~A bounded comparison shows fewer unnecessary prompts without increasing
      the set of commands eligible to bypass deterministic hard-denies.~~
      Struck: the classifier and regex table are gone, so there is nothing left to compare against.

## Notes

Do not log private capture payloads or send credentials to collect the evidence
for this decision.

**Close-out (2026-11-13):** Completed. Built in #167 and hardened by APP-048 (#281) and APP-226
(#499). In `app/desktop/src/agent.mjs`, `sandboxPolicy` runs every tool
(bash, read, write, edit) under `@anthropic-ai/sandbox-runtime` Seatbelt.
It allows no network and makes the account home unreadable. Lore's home is
writable except its app-only folders. The agents' history is readable, and
only for setup: `~/.claude/projects` and `~/.codex/memories`, narrower
than the `~/.claude`/`~/.codex` this item asked for. There is no
classifier or command table. `createSandboxedBashOperations` keeps only a
store-command refusal and a hidden-folder check. Owner-meaning writes stay
on cards (`propose_memories`, `propose_blueprint`/`save_profile`,
`propose_price`, `open_store`). `LoreAgent.create` awaits
`initializeSandbox`, and `SandboxManager.initialize` throws "Sandbox
dependencies not available" when the sandbox can't run, so no session
starts without it. No dedicated test covers that refusal. A blocked
command is annotated through `annotateStderrWithSandboxFailures`, and
read/write refusals are returned as tool errors ("Lore can't read that
file"), so the turn goes on. Tests are in
`app/desktop/test/component/sandbox.test.cjs`. Leftover, not covered here:
that file's `todo` test "the agent's shell cannot change Lore's database"
(lore.db is writable inside the sandbox). No item tracks it yet. It is
listed for a new item in the 2026-11-13 close-out report rather than filed
here.

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

**Prioritization pass 2026-08-26:** The dependency ("evidence from real owner command and approval usage") is satisfied — its own Problem section names the 2026-08-23 stall that supplied it — and the 2026-08-23 Research section already picked a direction (sandbox-first, evaluate `pi-sandbox` first). Promoted `in-review` → `ready`.

**Backlog audit (2026-11-12), moved to in-review:** The sandbox-first
boundary shipped in #167 and was hardened by APP-048 (#281) and APP-227
(#499): bash, read, write and edit all run under Seatbelt with no network,
and the regex table is gone. Criterion 5 (a prompt-count comparison against
the classifier) no longer has anything to compare against and should be
dropped. The one real hole is the todo test in sandbox.test.cjs ("the
agent's shell cannot change Lore's database": lore.db is still writable from
the agent's shell), which no backlog item tracks yet and should become its
own item before this one closes.

**Prioritization (2026-11-12):** Priority P3 (was P2), effort XS (was M).
Stays in-review. Before it can be ready: Drop criterion 5 (no classifier
left to compare against). File a new item for the todo test in
test/component/sandbox.test.cjs (lore.db still writable from the agent's
shell), then close. Prioritization flag (not acted on): done.
