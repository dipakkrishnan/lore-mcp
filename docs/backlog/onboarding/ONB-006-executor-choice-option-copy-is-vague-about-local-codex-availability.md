---
id: ONB-006
title: Executor-choice option copy is vague about local Codex availability
priority: P2
effort: S
component: onboarding
status: completed
related: [ONB-005]
blockers: []
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/241
created: 2026-09-11
updated: 2026-09-11
---

## Problem

On the final scheduling question of Phase 2 ("Which assistant should
synthesize your Lore?"), the Codex option's description reads "Use Codex
when it becomes available" even on a machine where the real, checkable
reason Codex can't run scheduled synthesis is narrower and already known:
the local Codex CLI isn't installed. `SKILL.md` §2 already has the agent run
`which claude codex` while gathering evidence, but §3 ("Confirm in one
pass") never tells it to use that result when phrasing the executor
options — so the option copy reads as an unshipped-feature placeholder
instead of a plain statement of local state. The correct, narrower reason
only surfaces one step later, in a follow-up confirmation card triggered
after the owner has already picked the non-runnable option.

This is the same shape of bug as ONB-005 (#240): a `SKILL.md` instruction
gap lets the agent generate plausible-sounding but inaccurate option copy,
and the fix is a prompt-wording change, not application code — nothing in
`app/desktop/src/renderer.js`'s option rendering is at fault; it displays
whatever label/description the agent supplies.

## Proposed approach

Reword `SKILL.md` §3's scheduling-exchange guidance to require using the
§2 `which claude codex` result when presenting the executor choice: if the
local `codex` binary isn't found, the Codex option's description should
state that plainly (e.g. "Codex CLI isn't installed on this machine, so
Claude is the runnable choice for scheduled synthesis") instead of "when it
becomes available" — matching what the existing follow-up confirmation card
already says correctly one step later. Optionally note that both options'
copy should be symmetric: each describes real, current, checkable state,
not one present-tense and one hypothetical.

## Acceptance criteria

- [x] The Codex option's description in the executor-choice question states
      plainly that the local Codex CLI is not available on this machine
      (per the `which claude codex` check already run in §2), rather than
      "when it becomes available"
- [x] `SKILL.md`'s wording ties the option copy to the §2 availability
      check so the first view and the later confirmation card agree,
      instead of the accurate reason only surfacing after the option is
      picked

## Notes

Cataloged from https://github.com/dipakkrishnan/lore-mcp/issues/241.

Fixed via a prompt-wording addition alone (`SKILL.md` §3 "Confirm in one
pass"), the same shape as ONB-005's fix: the executor-choice guidance now
tells the agent to base each option's description on the `which claude
codex` result already gathered in §2, with an explicit counter-example
("Codex CLI isn't installed on this machine..." instead of "when it becomes
available"). No application code changed — `renderer.js` correctly displays
whatever label/description the agent supplies, same as ONB-005 found.
