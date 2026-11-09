---
id: APP-282
title: Make Inventory, Connectors and Automations one-line rows
priority: P1
effort: L
component: desktop-app
status: in-progress
related: [APP-281, APP-255]
blockers: []
dependencies: [APP-281]
github_issue: null
created: 2026-11-02
updated: 2026-11-03
---

## Problem

After APP-281 the lists still use the old patterns: Inventory groups are boxed with letter avatars, two-line rows,
"No views yet" on every row, a column of Take down buttons and segmented pill filters whose counts don't add up;
Connectors are three-column tiles; Automations rows run to three lines.

## Proposed approach

Audit step 4 and principles §4: flat group header rows (label + count), one-line rows (status glyph · title ·
source icon · date · price), actions on hover or in the row menu, text tabs for filters, one status per memory.

## Acceptance criteria

- [x] Inventory is one-line rows on hairlines under flat, collapsible group headers; its text tabs (All / Private /
  Draft / On sale) add up to All.
- [ ] Connectors and Automations are one-line rows too.
- [ ] Connectors and Automations read as Linear's Integrations list.

## Progress

Inventory is done (PR "APP-282: Make Inventory one-line rows, like the mock"). Each row is title · actions on hover
(tag, ⋯) · source mark · status word · date · price. Where the old pieces went:

- The store card: its status, address and the one Update (pieces going on or off, a new price, a newer store) are in
  Settings → Your store → Address. The Inbox still raises the same update as a step. The price is on each row.
- Taken down: no tab of its own. A taken-down piece is private again and counts under Private, but it sits in a folded
  "Taken down" group at the foot, so it never reads as a second copy of a live piece.
- Sell something you wrote and + Add Memory: New → Writing to sell, and New → Memory.
- Take down: the piece's ⋯ menu, which asks first. Set price: the tag icon, the ⋯ menu, or P.
- Collections and Sales: their own groups at the foot of All and On sale.
- A memory opens as its own page, laid out as a bid's: title, body as prose, Draft for sale / Edit / ⋯ (Rename,
  Delete), Activity at the foot, and Status, Source, Topic and Updated beside it. ↑/↓ step through Inventory, Esc
  goes back. It replaces the memory sheet. A collection that has been set up opens on the same layout.

Readability pass, after the owner's library read as "kinda hard to read": groups were keyed on a piece's `topic`,
which a one-memory publish sets to that memory's whole title, so most groups were one sentence over one to three rows.
Groups are now where the memories came from (the memory's project, app or agent), and a piece or draft joins the
group of the memory it was drafted from. A memory sold on its own reads as its piece's row (⋯ → Open memory). Every
row carries the source mark and a date; headers are 13px medium on the side band, a size under 15px row titles, as
in the mock. Rows have no browser tooltip; a piece's views and sales show beside its actions on hover.

Connectors and Automations remain.
