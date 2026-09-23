---
id: XC-015
title: Pin the skill drive-contract in the contract tests
priority: P2
effort: S
component: cross-cutting
status: completed
related: [XC-005, XC-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-05
updated: 2026-09-22
---

## Problem

The owner skills share an implicit "drive contract" — one step at a time, announce a
page before opening it, verify from state instead of re-asking, defer decisions to the
owner — but only `lore-enable-payments` states it, and nothing enforces it anywhere.
The pattern was earned twice the hard way: the payments skill originally described
steps instead of driving them, and the first clean-machine onboarding stalled at
exactly the one wallet branch no live run had walked. The contract tests already pin
per-skill invariants (the `AskUserQuestion` control block, the payment-safety
phrases), so the mechanism exists; the drive rules just aren't in it. A future skill
— or a future edit to an existing one — can silently ship as a manual instead of a
script, and nothing goes red.

## Proposed approach

Extend `tests/test_skill_contract.py` with a test that iterates every owner skill
(same glob the `AskUserQuestion` test uses) and asserts the drive rules are present —
either by requiring the shared rule phrases per skill, or by requiring a common
`## How to drive` section whose canonical copy lives in one skill and is
byte-compared into the others. Decide during implementation which shape fights less
with per-skill wording; the `AskUserQuestion` block precedent suggests exact pinned
substrings are enough and simplest.

## Acceptance criteria

- [x] A contract test fails if any owner skill lacks the drive rules (one step at a
      time; announce-then-open; verify from state; decisions defer to the owner) —
      `test_every_owner_skill_states_the_drive_contract`.
- [x] The test names the offending skill and missing rule in its failure message,
      the way the `AskUserQuestion` test does — `subTest(skill=..., rule=...)` plus
      an explicit `f"{skill.name} is missing the '{rule}' drive rule"` message.
- [x] Adding a new skill directory under `plugins/lore/skills/` picks it up with no
      test edit — the test iterates `_owner_skills()`, the same dynamic glob the
      `AskUserQuestion` test already uses.

## Notes

Came out of the 2026-08-05 clean-machine onboarding review (PR #79 fixed the four
gaps it exposed). The general lesson recorded there: skills fail exactly where no
live run has walked them — this item is the cheap mechanical backstop for the
branches that XC-005-style dry-runs miss.

**Prioritization pass 2026-08-26:** No blockers, small effort, concrete AC extending an existing contract-test pattern. Promoted `in-review` → `ready`.

**Implementation (2026-09-22):** chose the pinned-substrings shape over the
byte-compared section, per the item's own note that the `AskUserQuestion`
precedent is simplest — `DRIVE_RULES` in `tests/test_skill_contract.py` maps each
rule name to the exact bolded lead-in `lore-enable-payments` already used
(`One step at a time.`, `Announce, then open.`,
`Verify from state, never by asking.`, `Defer at decision points.`). Added a
matching "How to drive" section to `lore-capture`, `lore-onboard`, and
`lore-publish`, worded to each skill's own flow rather than byte-identical, since
`lore-enable-payments`'s wallet-specific bullets don't generalize.
