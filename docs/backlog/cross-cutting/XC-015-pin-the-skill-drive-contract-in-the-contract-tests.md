---
id: XC-015
title: Pin the skill drive-contract in the contract tests
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-005, XC-003]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-05
updated: 2026-08-26
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

- [ ] A contract test fails if any owner skill lacks the drive rules (one step at a
      time; announce-then-open; verify from state; decisions defer to the owner).
- [ ] The test names the offending skill and missing rule in its failure message,
      the way the `AskUserQuestion` test does.
- [ ] Adding a new skill directory under `plugins/lore/skills/` picks it up with no
      test edit.

## Notes

Came out of the 2026-08-05 clean-machine onboarding review (PR #79 fixed the four
gaps it exposed). The general lesson recorded there: skills fail exactly where no
live run has walked them — this item is the cheap mechanical backstop for the
branches that XC-005-style dry-runs miss.

**Prioritization pass 2026-08-26:** No blockers, small effort, concrete AC extending an existing contract-test pattern. Promoted `in-review` → `ready`.
