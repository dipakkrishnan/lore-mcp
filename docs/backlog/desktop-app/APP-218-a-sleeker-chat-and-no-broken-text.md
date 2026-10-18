---
id: APP-218
title: A sleeker chat, and no broken text anywhere
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-215]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-17
---

## Problem

Lore's chat looks older than the apps its owners talk to every day. The
first-run chat (APP-215) puts a Lore icon on every line and a "YOU" tag on the
owner's, asks its first question with tall bordered cards, shows the message to
paste as a monospace block inside a bordered card, and sits under a big serif
"Welcome to Lore" with a "Getting started" eyebrow. Ordinary agent threads have
the same chrome. Next to Grok Bot's Mac app (text on the canvas, the owner's
message a soft pill, one floating rounded composer, almost no borders) it reads
as dated.

Nothing checks how text lands on screen either. A label that wraps onto two
lines, a box wider than its room, text cut off with no ellipsis, or two things
drawn over each other only gets caught if someone happens to look.

## Proposed approach

One visual language for every chat in the app, first run and threads alike:

1. No per-message icon and no "YOU" tag. Lore's lines sit on the page at a
   comfortable size and line height; the owner's answer is a soft pill on the
   right.
2. First-run answers are compact pills with each app's mark, in a wrapping
   row. Apps found on this Mac carry a quiet "On this Mac" dot; Muse stays
   visibly disabled.
3. The connect card is one calm surface (soft fill, larger radius, no hard
   border): the steps as one line, the message to send as one field with its
   key masked and Copy message, and Open Grok Bot beside the private-link note.
   No "add it yourself" fallback: Grok Bot has no menu for it (APP-217).
4. Lines come in once each with a short fade and rise, a beat apart, and never
   replay on a redraw; with reduced motion they just appear. The wait for the
   first save is three typing dots, not a grey dot.
5. The first-run header is a small title pill and a quiet Skip for now.
6. Threads get the same: unbubbled Lore text, owner pills, a rounded composer
   that floats at the bottom of the thread, and question, approval and
   confirmation cards as soft surfaces with pill buttons.

A layout guard in the edge harness runs inside every screenshot, at the
window's size and, for the walks that show the main tabs, at 900px wide. It
fails the walk on a page that scrolls sideways, a box wider than its room,
text cut off without an ellipsis, a one-line label (buttons, pills, chips,
tabs, nav items, headings, row titles) on two lines, or two neighbours drawn
over each other. Text meant to run on opts out with `data-wraps`, narrowly.

## Acceptance criteria

- [ ] No chat line carries an icon or a "YOU" label; owner answers are right-aligned pills.
- [ ] First-run answers are pills in a wrapping row, with marks; found apps say "On this Mac"; Muse is disabled.
- [ ] The connect card has no hard border and shows the message in words with its key masked; Grok Bot gets no hand-added-link fallback, since it has no such menu.
- [ ] Lines fade in once, in sequence, and not at all with reduced motion; the wait shows typing dots.
- [ ] The first-run header is a small title and a quiet Skip for now.
- [ ] Threads use the same language, with a floating rounded composer.
- [ ] Every edge screenshot runs the layout guard; the main-tab walks also run it at 900px; every walk passes.
