---
id: APP-127
title: Point Today at Connectors and say where an export comes from
priority: P1
effort: S
component: desktop-app
status: completed
related: [CAP-003, APP-125, APP-118, APP-120]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-27
updated: 2026-09-27
---

## Problem

Connectors is a tab (`APP-125`), but nothing sends an owner there. Today's
first nudge is "Connect your agents", which means nothing to a seller with
no Claude Code or Codex history (Zane, 2026-09-14). An export connector
(ChatGPT, Claude) asks for "the export you downloaded" without saying how to
get one. A connected feed or vault says it is "read again on its own when
Lore next runs", which is only true when a synthesis schedule is installed:
`lore sync` runs as that task's pre-hook and nowhere else. The FAQ explains
the money but never why connecting an app helps.

## Proposed approach

- Today: one "Bring in what you've written" item, for every owner with no
  app connected, that opens Connectors. The agent step stays as it is.
- Each export `Connector` carries a one-line `guide` (the app's own menu
  path), sent on the catalog's `App` model; the connect sheet shows it.
- The Manage sheet says "each time your schedule runs" only when one is
  installed, and otherwise that Lore looks only when the owner chooses Read
  again.
- FAQ: "Why connect my apps?", in the "What Lore does" section.

## Acceptance criteria

- [x] An owner with no app connected sees one Today item that opens
      Connectors; it goes away once an app is connected.
- [x] The ChatGPT and Claude sheets say where to get the export, read from
      the catalog rather than a renderer constant.
- [x] A connected app never claims to be read again on its own without a
      schedule that does it.
- [x] The FAQ answers why to connect apps in plain words; Today carries no
      explanation.
- [x] `docs/connectors.md` names the Connectors tab.

## Notes

Menu paths checked 2026-09-27 against OpenAI's "Exporting your ChatGPT
history and data" (Settings → Data controls → Export data; the emailed link
can take up to 7 days) and Claude's "Export your Claude data" (Settings →
Privacy → Export data). The connect → publish step that pairs with this is
`CAP-003`. Edge checks live in the `connectors` and `faq` scenarios.
