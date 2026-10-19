---
id: APP-212
title: See what an agent saved in one click
priority: P0
effort: M
component: desktop-app
status: completed
related: [APP-207, APP-213, APP-215]
blockers: [APP-213]
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-19
---

## Problem

When a connected agent saves its first memories, the connect sheet says so
and offers only Done. The owner has to close it and find the memories in
Inventory on their own. The Mac notification, the agent's card on
Connectors, and Today's New memories don't lead there either.

## Proposed approach

One place to land: Inventory, filtered to that agent, with the memories the
owner hasn't looked at yet marked "New" until they're seen. One click gets
there from each of:

- the connect sheet's status line: "Grok Bot saved 2 memories · See them →"
  (closes the sheet and goes there);
- the Mac notification for an agent's save;
- "Saved 2" on the agent's card in Connectors;
- the header of Today's New memories, when those came from an agent.

The filter shows as a removable chip ("Grok Bot ×") beside the All / Private /
On sale tabs.

Data: per-memory seen state does not exist today (Ready runs are marked seen
as a whole). Keep a durable set of seen memory ids in main, with a
`memory:seen(ids)` IPC; a memory is seen once its row is shown on screen.
"New" means arrived and not yet seen, by ingestion, never by `updated_at`
(imports can carry old dates). Notifications stay count-only. Today's header
links to one agent only when every memory under it came from that agent.

## Acceptance criteria

- [x] Each of the four entry points opens Inventory filtered to that agent in one click.
- [x] Memories not yet seen carry a quiet "New" mark that clears once seen.
- [x] Removing the chip shows everything again.
- [x] Edge checks cover each entry point.

## Notes

- Built (Oct 17), on APP-213's contributors:
  - Main keeps `memories-seen.json` in userData (`reading.Seen`: `since`, the
    newest memory when it began, and the ids seen after it), written beside and
    renamed over, one write at a time. IPC `memory:unseen(newest)` and
    `memory:seen(ids)` (1 to 500 positive integers).
  - New is Inventory's: a memory newer than `since` that was not seen before
    this visit. A row counts as seen once an IntersectionObserver finds it on
    screen while Lore is in front; its mark stays until the next visit. Today's
    rows do not count, so Today's See them still lands on New marks.
  - Inventory's source filter is a removable chip beside the tabs; while it is
    on, pieces for sale and Sales are hidden (a piece names no contributor).
  - Ways in: the connect sheet's line ("Grok Bot saved 1 memory · See them →"),
    the Mac notification for an agent's reading, "Saved N" on the agent's card,
    and Today's New memories header when every run and memory there is one
    agent's. A tile's click opens its own action, never a link in its text.
  - Edge (`agents`): each way in lands filtered with New marks, New clears on the
    next visit and is on disk for the next launch, and removing the chip shows
    everything; `reading` checks an app's header has no See them.
  - Review round 2: memories are known by arrival, not id. `memories.id` has no
    AUTOINCREMENT, so a deleted newest id comes back; a new `arrival` column is
    numbered from a one-row AUTOINCREMENT table (`memory_arrivals`), which never
    hands a number out twice. Older databases number arrivals by id and go on
    from the newest. Chosen over rebuilding `memories` as AUTOINCREMENT, which
    would mean copying the table under its FTS index and triggers.
  - A notification that opens a new window sends its route once that window's
    page has loaded (`reveal`), so a closed window still lands filtered.
  - Review round 3: a memory an older Lore wrote arrives with no number; the
    store numbers it the next time it opens. The FTS update trigger now fires only
    on title, content and project, so numbering arrivals never re-indexes. A
    notification also waits for a window that is still loading.

**Completed (verified 2026-10-19, by reading code and tests, no suites run):** on main in 4b96cff. Closed out in the review-queue pass.
