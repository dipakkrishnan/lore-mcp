---
id: APP-213
title: Show where every memory came from
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-207, APP-210, APP-212]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-17
---

## Problem

A memory row often says only "Private". Today's New memories from a routine
(for example "Granola analysis") and the hover preview ("personal · Oct 14")
don't say where the memory came from, so the owner can't tell an agent's save
from a routine's output, an app's notes, or their own writing.

## Proposed approach

Every memory row shows its source's mark in a small tile that overlaps the
card's top-left corner, like the stacked agent marks on Connectors: the
agent's mark, the app's mark (Obsidian, Substack, ChatGPT, Claude), a clock
for a routine, a pen for something the owner wrote. The secondary line leads
with "From <source>". The hover preview leads with "From <source> · <date>".
This applies to Today's New memories, Inventory, and the preview.

A memory Lore synthesized can draw on several sources over time. Show every
contributor as stacked marks, each overlapping the last ("From Grok Bot and
Obsidian"), newest first, at most three marks plus "+N".

Data: `Store.memory_inventory()` returns only id, title, project, status and
date, so source and origin must reach the snapshot. Synthesized and routine
memories are stored as `source=automation`; record their contributors (source
or routine id plus label) when a reading lands, and keep labels after an agent
is disconnected. Older automation memories that can't be attributed say
"Written by Lore" rather than a guess. A capture made in the app says "From
you"; a capture of an imported file says the file's app.

## Acceptance criteria

- [ ] Every memory row on Today and Inventory shows a source mark and "From <source>".
- [ ] Routine output says "From <routine name>" with the clock mark.
- [ ] The hover preview leads with the source and date.
- [ ] Nothing shows "personal" or a bare "Private" as the only provenance.
