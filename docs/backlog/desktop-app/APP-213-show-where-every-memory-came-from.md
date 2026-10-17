---
id: APP-213
title: Show where every memory came from
priority: P1
effort: M
component: desktop-app
status: in-review
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

## Notes

- Built (Oct 17):
  - Store: a `memory_contributors` table (memory, kind agent|app|routine|capture,
    id, label, mark, at), one row per contributor, newest first, deleted with its
    memory. `CREATE TABLE IF NOT EXISTS` adds it to older databases on open.
  - Every source read puts its app or agent on record for what it brought in
    (`Registry._import`), so labels and marks outlive a disconnect. When a reading
    lands, the app credits what it wrote to the agent, app or routine that read
    (`lore memory credit -`, from `Reading.by`).
  - Memories with nobody on record are named by their source, never guessed:
    Lore's own writing says "Written by Lore"; a capture is "you" (pen), or a
    file's app when it sits in a connected folder, or the file's name.
  - `sources` is on `memory_inventory`, the snapshot items and `memory show`.
  - Renderer: `provenance()` draws stacked tiles (three, then "+N") and "From A,
    B and 2 more" on Today's New memories, Inventory rows, the preview and the
    memory sheet; the old `origin()` guess is gone.
  - Edge: agents (Grok marks on Today, Inventory, preview, after disconnect),
    reading (Granola marks, "Written by Lore"), automations (clock and routine name).
