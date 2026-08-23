---
id: APP-020
title: Make Today a simple inbox for unfinished Lore tasks
priority: P1
effort: M
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

Memories, Store, and Settings hold up, but an unfinished agent conversation
has no durable, obvious place to resume. Today also uses the same composer
for starting a capture and replying inside setup, which makes one interaction
look like two unrelated modes. Inferring task state later from assistant prose
or Bash heredocs would make the product depend on model wording and shell
formatting rather than an explicit contract.

## Proposed approach

Design canvas: https://claude.ai/code/artifact/e2b6e778-ea36-4d72-9b9c-7fdd947df8c5
(six artboards: Today with task rows, task view working, task view stopped
and resumed, onboarding as pre-flight + one editable blueprint, the card
vocabulary, and a low-fi "one thread" alternate).

- **Explicit task records** — write a versioned `lore.task` custom entry into
  the existing Pi session with `SessionManager.appendCustomEntry()`. The app
  owns `kind`, `title`, and state (`needs_you`, `working`, `stopped`, `done`);
  `tasks()` reads only the latest typed entry. It never parses conversation
  text, model output, or Bash commands.
- **Today** — greeting, at most one pending card, up to three unfinished task
  rows, the capture composer, and the existing facts strip. Completed capture
  and publication tasks disappear because Memories and Store already record
  their outcomes.
- **Task view** — back link, title and state, one short phase label, thread,
  current question or approval, and a composer labelled "Reply to Lore…".
  No timeline, dashboard, or second task navigation system.
- **Progress** — working/needs-you/stopped/done come from app lifecycle events.
  If a skill must name a semantic phase, add one bounded `task_progress` tool
  that appends a typed custom entry; do not infer it from prose or Bash.
- **Onboarding** — show one quiet evidence line, then one editable blueprint
  proposed from that evidence. A typed `propose_blueprint` tool returns the
  owner's edits; "Use this shape" invokes the existing validated
  `lore blueprint apply` write path. Ask serial questions only for fields the
  evidence cannot support.

## Acceptance criteria

- [ ] Task state is stored as versioned custom Pi session entries and survives
      relaunch; no code derives it from prose, tool arguments, or heredocs.
- [ ] Today shows no more than three unfinished tasks and one pending card;
      completed work remains in Memories or Store instead of a task ledger.
- [ ] A pending card is answerable from Today without opening the task.
- [ ] Opening a task shows only its title/state, phase, thread, current card,
      and reply composer.
- [ ] Onboarding shows the pre-flight, then one editable blueprint card that
      writes through `lore blueprint apply` on approval.
- [ ] Tests prove typed task records, task listing, interruption/resume, and
      the blueprint tool's bounded input.

## Notes

Filed from Dipak's request on 2026-08-23 ("this cohesion work is pretty
fundamental; it needs to feel seamless"). Scope cut after review: no full task
history, six-card taxonomy, standing policies, inferred progress, or granular
working animation. Standing policy remains APP-008 work and must not alter the
deterministic Bash boundary here. The design canvas remains directional; this
item's smaller contract is authoritative.
