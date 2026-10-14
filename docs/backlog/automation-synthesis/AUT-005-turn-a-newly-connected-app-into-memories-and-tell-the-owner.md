---
id: AUT-005
title: Turn a newly connected app into memories and tell the owner
priority: P1
effort: M
component: automation-synthesis
status: in-review
related: [AUT-002, AUT-006, AUT-007, APP-042, MON-037]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-13
updated: 2026-10-13
---

## Problem

Connecting an app such as Granola brings in one raw memory per meeting, and
then nothing else happens. The only next step is "Draft for sale". Scheduled
synthesis can't fill the gap: it runs through Claude Code or Codex, which
non-developers usually don't have, it runs once a day, and its prompt ignores
connector imports. Zane, the first trial seller, said he'd get hooked only if he
could "quickly upload tons of stuff via connectors and start getting paid". He
uses Granola every day, wants work context anonymized, and wants personal kept
apart from work.

## Proposed approach

- When a connect or Read again brings in something new from an app, the app
  queues a background reading on its own agent (a new `synthesize` task with
  the `lore-synthesize` skill). It reads one source at a time, never asks the
  owner anything, and stops for the owner's next turn. After that turn it
  starts again from the beginning.
- One set of rules (`automation.RULES`, printed by `lore memory rules`)
  governs both this reading and the scheduled prompt. The rules cover what
  earns a place in memory, how work is kept apart from personal life, and how
  topic files and INDEX.md are written. Work goes under `memories/work/`, is
  labelled "work" in Memories, and is never suggested for sale. A lesson
  learned at work can be suggested only as its own anonymized topic.
- The reading writes topic files and calls `memories_ready`. The app then
  syncs them through `lore sync --source automation` and posts a Mac
  notification. It also sets a red dock badge counting the unseen new
  memories and shows a "New memories" card on Today. Rows worth selling get
  Draft for sale; work rows say "Work · stays private". The badge clears once
  the owner has seen the card, and Clear takes the card away.

## Acceptance criteria

- [x] A connect or read that adds items starts exactly one reading. One that
      adds nothing, or comes from the agents' own memories, starts none.
- [x] The reading never locks the composer. An owner's turn stops it, and it
      starts again afterwards with every waiting item.
- [x] The scheduled prompt and the in-app reading share one rules text, and
      the scheduled prompt now reads connected apps too.
- [x] Work is never offered for sale, whatever the reading reported.
- [x] A notification, a dock badge that counts unseen memories, and a Today
      card with Draft for sale; a reading that finds nothing posts nothing.
- [x] Covered by Python, desktop and `support/edge.sh reading` tests.

## Notes

- A reading has not yet been run against a real Granola account with a real
  model. The edge scenario stands in for the model step and keeps everything
  around it real.
- Known edge: the app's `lore sync --source automation` closes an open
  scheduled synthesis job row if one is running at that moment, the same way
  a hand-run sync does.
- Follow-ups: AUT-006 (let the schedule run on the in-app agent) and AUT-007
  (resume a reading that Lore closed partway through).
