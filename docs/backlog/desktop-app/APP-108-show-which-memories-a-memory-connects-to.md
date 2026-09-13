---
id: APP-108
title: Show which memories a memory connects to
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-042, APP-046, APP-096, APP-107, APP-110, CAP-002]
blockers: []
dependencies: [CAP-002]
github_issue: null
created: 2026-09-12
updated: 2026-09-12
---

## Problem

Every memory in Lore is an island. The memory sheet shows title, content,
Rename, Edit, and Draft for sale. Nothing says that "Pricing lesson" was
learned from "Failed launch at Actively", even though the agent that captured
it knew that at the time. An owner reading one memory has no way to reach the
ones that explain it, and no sense of which memories are load-bearing.

Obsidian's note view (walked 2026-09-11) shows three things for every note:
Linked mentions (which notes point here, each with the sentence that contains
the link), Unlinked mentions (notes that name this title in plain text but
have not linked it), and outgoing Links. The status bar counts backlinks. The
connecting sentence is what makes the list readable; a bare title list would
not be.

## Proposed approach

Two halves. The first is `CAP-002`, not desktop work, and is the dependency above.

**Store the link.** When the capture agent drafts a memory, it already reads
the owner's words against the existing library. Let the capture entry carry
`related: [<memory id>, ...]` with one sentence per link explaining the
connection, validated by `lore capture apply` and written to a small
`memory_links` table in `lore.db`. The snapshot (`APP-001`) exposes each
memory's links in both directions.

**Render it.** On the memory sheet, below the content, a Related section:

- Each row is the other memory's title and the connecting sentence, in
  whichever direction the link runs ("Learned from" / "Led to").
- Clicking a row opens that memory's sheet; the back control returns.
- The Memories list row shows a small connection count next to the captured
  date, so a well-connected memory is visible before it is opened.
- Unlinked mentions are out of scope for now; a plain-text title match across
  a few hundred memories is cheap but the UI for confirming a link is not.

## Acceptance criteria

- [ ] A memory sheet lists the memories linked to it in either direction, each with the connecting sentence, and clicking one opens it.
- [ ] A memory with no links shows no Related section rather than an empty one.
- [ ] The Memories list shows a connection count on rows that have one.
- [ ] The snapshot carries links for every memory, and the renderer reads only the snapshot.

## Notes

Filed 2026-09-12 from an operated comparison of Obsidian 1.13's backlinks pane
against the current Lore memory sheet. The `memories` table in
`lore/store.py` has no link column today, and `lore/capture.py` validates
title, project, source_path, and content only; `CAP-002` owns that half.

`APP-042` (select memories to combine and synthesize) is the other direction
of the same idea: links made by the owner rather than the agent. A synthesis
produced from a selection is a natural place to write links from the result
back to its sources.
