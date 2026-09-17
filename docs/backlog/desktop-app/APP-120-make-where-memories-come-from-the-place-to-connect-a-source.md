---
id: APP-120
title: Make "Where memories come from" the place to connect a source
priority: P1
effort: M
component: desktop-app
status: completed
related: [STO-003, CAP-004, CAP-005, CAP-006, CAP-007, APP-116, APP-109, ONB-007, APP-122]
blockers: []
dependencies: ["STO-003 for per-source state in the snapshot"]
github_issue: null
created: 2026-09-17
updated: 2026-09-17
---

## Problem

Settings already has a "Where memories come from" card, but its rows are
fixed to Claude Code and Codex, show a green dot for "root exists", and
offer nothing to add. An owner like Zane arrives with a vault, a
newsletter, and chat exports and finds no door. Nothing in the app names
what Lore would read, asks before reading it, shows what it found, or says
what happens to kept memories on disconnect.

## Proposed approach

Expand the existing section rather than adding a tab: every product with
under ten sources (Granola, Limitless) keeps this a list inside Settings,
and Lore's own precedent is Sales as a section inside For Sale. Promote
later if the catalog passes about eight.

- Rows reuse `row()`: a 20 px bundled logo, the service's name, a verb-first
  line under 55 characters naming the boundary ("Reads the notes in one
  vault you pick."), status on the right, chevron to a detail sheet. The
  healthy state carries no colour word, just "142 kept · 12 minutes ago";
  every other state is named (Needs permission, Sign in again, Couldn't
  reach it, Paused) with one sentence and one action. No buttons in the
  list except Reconnect when a row needs attention.
- "+ Add a source" opens a sheet that is the catalog: one list, each row
  logo, name, one-liner, Connect. No search until the count passes twelve.
- One detail sheet per source: logo, name, the one-liner, the disclosure,
  one button. Six connect shapes: folder pick; macOS permission (Apple's
  HIG: a single Continue, benefit-named copy, the scary system wording
  pre-empted); URL or handle paste that resolves on blur and shows what it
  found; token paste that autosaves to the keychain; OAuth in the system
  browser with a loopback redirect and the phase narrated on the button;
  the signed-in window from `APP-116`.
- After connecting, read the index only and show a preview: the count, the
  honest boundary ("34 shorter than a sentence were skipped"), a checklist
  defaulting to the last twelve months with everything one click away.
  Then the existing correction flow. No second approval.
- Disconnect asks "Keep the 142 memories it already kept?" with Keep,
  Delete them too, Cancel.
- Today raises the first connect as a Needs You card (`ONB-007`); Settings
  is the after-the-fact list.

## Acceptance criteria

- [x] A fresh owner can add an Obsidian vault from Settings, see the
      preview, keep a subset, and find them in Memories, without a terminal.
- [x] A source whose last read failed shows a named state and an action,
      never a green dot.
- [x] Disconnecting offers keep or delete, and Memories reflects the choice.
- [x] The edge harness has a `sources` scenario covering add, preview,
      failure, and disconnect.

## Notes

Shipped 2026-09-17 against `STO-003`. Settings only: the rows, the catalog
sheet, the folder-pick connect flow with its preview, and the detail sheet
with Read again and an inline Disconnect confirm. The Today Needs-You card
for the first connect is deliberately left out and waits for `ONB-007`.

Cut to one catalog entry and one connect shape (folder pick), because only
the folder reader exists: the other five shapes land with `CAP-004`–`CAP-007`
and `APP-116`. Rows carry a neutral outline glyph rather than a logo, which
is `APP-122`'s. The preview keeps a whole folder from a date rather than a
per-item checklist; `--since` on the source is what the CLI persists, and a
checklist would need a second write path.

Copy deviations from the plan above: the named states are "Needs permission",
"Can't find it", and "Nothing to read" — no "Sign in again" or "Paused" until
a source kind can be in them. In the preview sheet an empty folder reads
"Nothing to read in that folder yet." rather than the row's "Connected,
nothing to read yet.", since nothing is connected at that point.

An unreachable folder's "Pick it again" runs the same connect flow, so a
folder that moved is added at its new path and the stale row is disconnected
by hand. Re-pointing a source in place would need a CLI verb.

Filed 2026-09-17 from the connector research (Town, ChatGPT, Claude,
Granola, Notion, Dust, Perplexity, Plaid, Raycast). Keep the word
"connector" out of the copy; the section heading is the name. The pulsing
`.pill i` already serves as the Connecting indicator.
