---
id: APP-120
title: Make "Where memories come from" the place to connect a source
priority: P1
effort: M
component: desktop-app
status: in-progress
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

- [ ] A fresh owner can add an Obsidian vault from Settings, see the
      preview, keep a subset, and find them in Memories, without a terminal.
- [ ] A source whose last read failed shows a named state and an action,
      never a green dot.
- [ ] Disconnecting offers keep or delete, and Memories reflects the choice.
- [ ] The edge harness has a `sources` scenario covering add, preview,
      failure, and disconnect.

## Notes

Filed 2026-09-17 from the connector research (Town, ChatGPT, Claude,
Granola, Notion, Dust, Perplexity, Plaid, Raycast). Keep the word
"connector" out of the copy; the section heading is the name. The pulsing
`.pill i` already serves as the Connecting indicator.
