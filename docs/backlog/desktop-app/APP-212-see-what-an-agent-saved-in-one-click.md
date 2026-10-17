---
id: APP-212
title: See what an agent saved in one click
priority: P0
effort: M
component: desktop-app
status: ready
related: [APP-207, APP-213, APP-215]
blockers: [APP-213]
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-17
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

- [ ] Each of the four entry points opens Inventory filtered to that agent in one click.
- [ ] Memories not yet seen carry a quiet "New" mark that clears once seen.
- [ ] Removing the chip shows everything again.
- [ ] Edge checks cover each entry point.
