---
id: CAP-002
title: Store links between memories at capture time
priority: P2
effort: M
component: capture
status: in-review
related: [CAP-001, APP-108, APP-042, APP-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-12
updated: 2026-09-12
---

## Problem

When the capture agent drafts a memory, it reads the owner's words against
the existing library and often knows which earlier memories the new one
grows out of: "Pricing lesson" was learned from "Failed launch at Actively".
That knowledge is thrown away at write time. The `memories` table in
`lore/store.py` has no way to hold a relationship between two rows, and the
capture entry validated by `lore/capture.py` carries only title, project,
source_path, and content. Every memory lands as an island, and nothing
downstream (desktop, synthesis, publication drafting) can ask what connects
to what.

## Proposed approach

Smallest change that gives the desktop (`APP-108`) something to render:

- A `memory_links` table: `from_id`, `to_id`, `reason` (one sentence, the
  connecting claim), `created_at`. One direction stored; readers query both.
  Deleting or discarding a memory drops its links.
- The capture entry accepts an optional `related` list of `{id, reason}`.
  `lore capture apply` validates that each id exists and is private, rejects
  self-links, and writes the rows inside the same transaction as the memory.
- The `lore-capture` skill's proposal step names candidate links alongside
  the drafted memory, so the owner sees and can strike a wrong link on the
  same card that approves the memory. Links are proposed by the agent and
  approved by the owner, like everything else that gets written.
- The desktop snapshot (`APP-001`) exposes, per memory, the links in both
  directions with their reasons.

Out of scope: inferring links for memories already in the library, and
plain-text title matching (Obsidian's "unlinked mentions"). Both are separate
items once the stored shape exists.

## Acceptance criteria

- [ ] A capture entry with a valid `related` list writes the memory and its links atomically; an invalid id, a discarded target, or a self-link rejects the whole entry with a message that names the bad link.
- [ ] `lore capture apply` without `related` behaves exactly as today.
- [ ] Discarding a memory removes its links in both directions.
- [ ] The snapshot lists each memory's links with reasons in both directions.
- [ ] The capture skill's proposal card shows candidate links and lets the owner strike one before approving.

## Notes

Filed 2026-09-12 as the storage half of `APP-108`, which was drafted from an
operated comparison of Obsidian 1.13's backlinks pane against the Lore
memory sheet. The reason sentence is load-bearing: a list of bare titles is
not readable, and the sentence is what the agent already has when it
proposes the link.
