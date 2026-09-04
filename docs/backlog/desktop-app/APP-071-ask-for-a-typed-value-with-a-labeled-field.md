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

No new question kind. A question with an empty options list already renders
the existing text field alone; the system prompt tells the agent to ask for a
value that way, with the label in the question text. Shorten long answers in
the echo and in reconstructed history (`agent.mjs` history()) so a pasted
address shows as "0x0c27…8166" in the thread now and after relaunch. Format
validation stays where it is, in the CLI's wallet check; the agent re-asks on
its error.

## Acceptance criteria

- [ ] The wallet step asks for the address with a single labeled field.
- [ ] A recovery phrase or a truncated copy is refused inline before it
      reaches the agent.
- [ ] The thread shows the address labeled and shortened, matching Settings.

## Notes
Reviewed 2026-09-04: a pattern schema is unwarranted; the CLI already refuses a bad address and the agent already handles that.
