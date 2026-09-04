---
id: APP-071
title: Ask for a typed value with a labeled field, not a one-option list
priority: P1
effort: S
component: desktop-app
status: in-review
related: [XC-024, APP-056, APP-057]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-04
updated: 2026-09-04
---

## Problem

`ask_user` only takes option lists, so when the deploy agent needs a value
it fakes a question: one radio option "Ready to paste — enter the 0x address
in your response" and the owner is expected to use the "Or type your answer"
field. The pasted address is then echoed into the thread as a bare
forty-character line, and its shape is only checked a turn later by the skill
(dogfood 2026-09-04).

## Proposed approach

Add a text kind to the ask tool: label, placeholder, optional pattern. The
renderer shows one labeled input, validates the pattern before Continue
(`0x` plus 40 hex for an address), and echoes a labeled, truncated summary
("Payout address 0x0c27…8166") instead of the raw value. The secret card stays
separate and keeps echoing nothing.

## Acceptance criteria

- [ ] The wallet step asks for the address with a single labeled field.
- [ ] A recovery phrase or a truncated copy is refused inline before it
      reaches the agent.
- [ ] The thread shows the address labeled and shortened, matching Settings.

## Notes

