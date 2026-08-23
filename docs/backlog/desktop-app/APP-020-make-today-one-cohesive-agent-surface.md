---
id: APP-020
title: Make Today one cohesive agent surface — tasks, typed cards, live steps, named states
priority: P1
effort: L
component: desktop-app
status: in-review
related: [APP-017, APP-018, APP-007, APP-004, APP-009, APP-015, APP-016]
blockers: [APP-018]
dependencies: []
github_issue: null
created: 2026-08-23
updated: 2026-08-23
---

## Problem

Memories, Store, and Settings hold up; every path that enters an agent
conversation does not. The thread is the only object, so setup steps,
the stats strip, and "Needs you" sit beside it as unrelated widgets; a
pending question is invisible unless the thread is on screen; a turn can
end in a state with no name; and an unfinished setup has no row to come
back to. Research on Town, Grok Bot, Claude Cowork, ChatGPT Work, Cursor 3
and Raycast (2026-08-23) converges on the same shape: the task is the
object and the thread is its detail view; approvals are typed cards with a
standing policy; working state is a live step list; terminal states are
named; sessions are durable and listed from the shell.

## Proposed approach

Design canvas: https://claude.ai/code/artifact/e2b6e778-ea36-4d72-9b9c-7fdd947df8c5
(six artboards: Today with task rows, task view working, task view stopped
and resumed, onboarding as pre-flight + one editable blueprint, the card
vocabulary, and a low-fi "one thread" alternate).

- **Tasks** — every entry point (Start, Publish, a capture) becomes a Task
  row on Today: title, state chip (Needs you / Working / Done / Stopped),
  one-line last event, time. Rows are rebuilt from the persisted pi
  sessions (APP-018) so they survive a relaunch. Opening a row shows the
  task view: step list, thread, current card, composer reading "Reply to
  Lore…" with a Send button.
- **Needs you** — the pending card itself renders at the top of Today
  ("From Set up my Lore · step 2 of 3"), answerable without opening the
  task.
- **Cards** — six kernel-emitted types: Choice (single/multi, free text
  always), Confirm (keep), Approve (publication), Stopped, Done, Working.
  Confirm carries a standing policy ("Ask each time / Always allow").
- **Steps** — the step bar is the plan; the current step shows live
  sub-steps (check / pulse / empty); the live line streams under the
  thread.
- **Stopped** — what happened, why, what to do: "Try again" / "Tell Lore
  what to do"; the composer focuses with "Tell Lore what to do…".
- **Onboarding** — deterministic pre-flight first ("Read before asking":
  what was read, what was skipped), then ONE editable blueprint card drafted
  from the evidence (name, persona segmented, topics / in depth / lightly
  as chips, voice) with "Change it" / "Use this shape". Five serial
  questions collapse into a proposal the owner corrects.

## Acceptance criteria

- [ ] Today shows Task rows with the four named states, rebuilt from
      persisted sessions on launch; opening one shows its thread and steps.
- [ ] A pending card is answerable from Today without opening the task.
- [ ] Every owner interruption is one of the six card types; nothing else
      asks in prose.
- [ ] A stopped turn renders the Stopped card with both actions.
- [ ] Onboarding shows the pre-flight, then one editable blueprint card that
      writes through `lore blueprint apply` on approval.
- [ ] The working step list reflects real kernel progress (tool calls
      mapped to sub-steps), not a scripted animation.

## Notes

Filed from Dipak's request on 2026-08-23 ("this cohesion work is pretty
fundamental; it needs to feel seamless"). The alternate on page 2 (Today as
a single thread, Grok Bot style) is cheaper but buries pending cards and has
no per-task timeline; Main holds the leading candidate. The step list needs
a kernel-side mapping from skill phases to sub-steps — likely a small
`progress` event the skill emits through a tool, not inference from bash
commands. Standing policies on Confirm cards interact with the deterministic
bash policy (APP-008 learned auto mode).
